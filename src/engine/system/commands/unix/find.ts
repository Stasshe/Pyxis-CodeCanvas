import { FSError, posixPath } from '@/engine/core/fs/index';
import type { ProjectFile } from '@/types/index';
import {
  type EvalContext,
  ExprBuilder,
  type Expression,
  ExprParser,
  evaluate,
  FNM_CASEFOLD,
  fnmatch,
} from '../../shell/lib/index';
import { UnixCommandBase, UnixCommandFailure } from './base';
import { displayPathForOperand } from './displayPath';

/**
 * find - ファイルを検索 (POSIX/GNU準拠)
 *
 * 使用法:
 *   find [path...] [expression]
 *
 * サポートする式:
 *   -name pattern   : basename に対する glob
 *   -iname pattern  : 大文字小文字を無視した basename glob
 *   -path pattern   : パス全体に対する glob
 *   -ipath pattern  : 大文字小文字を無視したパス glob
 *   -type f|d       : ファイル/ディレクトリ
 *   -maxdepth N     : 最大探索深度
 *   -mindepth N     : 最小探索深度
 *   -prune          : ディレクトリをpruneする
 *   -o              : OR演算子
 *   -a              : AND演算子（暗黙的）
 *   !  / -not       : 否定
 *   \( \)           : グループ化
 */

/**
 * find用の評価コンテキスト
 */
interface FindContext extends EvalContext {
  file: ProjectFile;
  fullPath: string;
  baseName: string;
  depth: number;
  fileType: ProjectFile['type'];
  empty: boolean;
  prune: boolean;
  print: boolean;
}

/**
 * find用の式パーサー
 */
class FindExprParser extends ExprParser<FindContext> {
  protected parsePredicate(): Expression | null {
    const tok = this.stream.peek();
    if (!tok) return null;

    switch (tok) {
      case '-name': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) throw new UnixCommandFailure("find: missing argument to '-name'", 1);
        return ExprBuilder.predicate('-name', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatch(pattern, fc.baseName) === 0;
        });
      }

      case '-iname': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) throw new UnixCommandFailure("find: missing argument to '-iname'", 1);
        return ExprBuilder.predicate('-iname', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatch(pattern, fc.baseName, FNM_CASEFOLD) === 0;
        });
      }

      case '-path':
      case '-wholename': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) throw new UnixCommandFailure(`find: missing argument to '${tok}'`, 1);
        return ExprBuilder.predicate('-path', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatch(pattern, fc.fullPath) === 0;
        });
      }

      case '-ipath':
      case '-iwholename': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) throw new UnixCommandFailure(`find: missing argument to '${tok}'`, 1);
        return ExprBuilder.predicate('-ipath', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatch(pattern, fc.fullPath, FNM_CASEFOLD) === 0;
        });
      }

      case '-type': {
        this.stream.consume();
        const typeChar = this.stream.consume();
        if (!typeChar) throw new UnixCommandFailure("find: missing argument to '-type'", 1);
        if (!['f', 'd', 'l', 'p', 'c', 'b', 's'].includes(typeChar)) {
          throw new UnixCommandFailure(`find: invalid argument '${typeChar}' to '-type'`, 1);
        }
        return ExprBuilder.predicate('-type', [typeChar], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          if (typeChar === 'f') return fc.fileType === 'file';
          if (typeChar === 'd') return fc.fileType === 'folder';
          if (typeChar === 'l') return fc.fileType === 'symlink';
          if (typeChar === 'p') return fc.fileType === 'fifo';
          if (typeChar === 'c') return fc.fileType === 'characterDevice';
          return false;
        });
      }

      case '-empty': {
        this.stream.consume();
        return ExprBuilder.predicate('-empty', [], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          // ファイルの場合はサイズ0、ディレクトリの場合は空
          if (fc.fileType === 'file') {
            return fc.file.size === 0;
          }
          if (fc.fileType === 'symlink') return false;
          return fc.empty;
        });
      }

      case '-prune': {
        this.stream.consume();
        return ExprBuilder.predicate('-prune', [], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          if (fc.fileType === 'folder') fc.prune = true;
          return true;
        });
      }

      case '-print': {
        this.stream.consume();
        return ExprBuilder.predicate('-print', [], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          fc.print = true;
          return true;
        });
      }

      case '-true': {
        this.stream.consume();
        return ExprBuilder.true();
      }

      case '-false': {
        this.stream.consume();
        return ExprBuilder.false();
      }

      default:
        if (tok.startsWith('-')) {
          throw new UnixCommandFailure(`find: unknown predicate '${tok}'`, 1);
        }
        return null;
    }
  }
}

function usesEmptyPredicate(expr: Expression | null): boolean {
  if (!expr) return false;
  if (expr.kind === 'predicate') return expr.name === '-empty';
  if (expr.kind === 'not') return usesEmptyPredicate(expr.operand as Expression);
  if (expr.kind === 'and' || expr.kind === 'or') {
    return (
      usesEmptyPredicate(expr.left as Expression) || usesEmptyPredicate(expr.right as Expression)
    );
  }
  return false;
}

function usesPrintPredicate(expr: Expression | null): boolean {
  if (!expr) return false;
  if (expr.kind === 'predicate') return expr.name === '-print';
  if (expr.kind === 'not') return usesPrintPredicate(expr.operand as Expression);
  if (expr.kind === 'and' || expr.kind === 'or') {
    return (
      usesPrintPredicate(expr.left as Expression) || usesPrintPredicate(expr.right as Expression)
    );
  }
  return false;
}

export class FindCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    // --help support
    if (args.includes('--help') || args.includes('-h')) {
      return 'Usage: find [path...] [expression]\n\nSearch for files in a directory hierarchy. See man/find for supported expressions and predicates.';
    }

    // Separate starting paths from the expression.
    const paths: string[] = [];
    let exprStart = 0;
    let i = 0;
    for (; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--') {
        exprStart = i + 1;
        continue;
      }
      if (
        arg.startsWith('-') ||
        arg === '!' ||
        arg === '(' ||
        arg === ')' ||
        arg === '\\(' ||
        arg === '\\)'
      ) {
        exprStart = i;
        break;
      }
      paths.push(arg);
      exprStart = i + 1;
    }

    if (i >= args.length) exprStart = args.length;

    if (paths.length === 0) {
      paths.push('.');
    }

    // グローバルオプションを分離
    const exprTokens: string[] = [];
    let maxDepth = Number.MAX_SAFE_INTEGER;
    let minDepth = 0;

    for (let i = exprStart; i < args.length; i++) {
      const arg = args[i];
      if (arg === '-maxdepth' && i + 1 < args.length) {
        const value = args[++i];
        const depth = Number(value);
        if (!Number.isInteger(depth) || depth < 0) {
          throw new UnixCommandFailure(`find: invalid argument '${value}' for '-maxdepth'`, 1);
        }
        maxDepth = depth;
      } else if (arg === '-mindepth' && i + 1 < args.length) {
        const value = args[++i];
        const depth = Number(value);
        if (!Number.isInteger(depth) || depth < 0) {
          throw new UnixCommandFailure(`find: invalid argument '${value}' for '-mindepth'`, 1);
        }
        minDepth = depth;
      } else {
        exprTokens.push(arg);
      }
    }

    // 式をパース
    const parser = new FindExprParser(exprTokens);
    const expr = parser.parse() as Expression | null;

    const results: string[] = [];
    const checkEmpty = usesEmptyPredicate(expr);
    const explicitPrint = usesPrintPredicate(expr);

    for (const p of paths) {
      const normalizedPath = this.resolvePath(p);
      const startFile = await this.getLinkAwareFile(normalizedPath);
      if (!startFile) {
        throw new UnixCommandFailure(`find: '${p}': No such file or directory`, 1);
      }
      const found = await this.findFiles(
        p,
        normalizedPath,
        startFile,
        expr,
        maxDepth,
        minDepth,
        checkEmpty,
        explicitPrint
      );
      results.push(...found);
    }

    // 重複除去
    const seen = new Set<string>();
    const unique: string[] = [];
    for (const r of results) {
      if (!seen.has(r)) {
        seen.add(r);
        unique.push(r);
      }
    }

    return unique.join('\n');
  }

  private async findFiles(
    operand: string,
    startPath: string,
    startFile: ProjectFile,
    expr: Expression | null,
    maxDepth: number,
    minDepth: number,
    checkEmpty: boolean,
    explicitPrint: boolean
  ): Promise<string[]> {
    const results: string[] = [];
    const displayStart = displayPathForOperand(operand, startPath, startPath);
    const pruned = new Set<string>();
    const isEmpty = async (file: ProjectFile): Promise<boolean> => {
      if (file.type === 'file') return file.size === 0;
      if (file.type !== 'folder') return false;
      if (!checkEmpty) return false;
      return (await this.fs.readdir(file.path)).length === 0;
    };

    // 開始パス自体をチェック
    if (0 >= minDepth && 0 <= maxDepth) {
      const ctx: FindContext = {
        file: startFile,
        fullPath: displayStart,
        baseName: posixPath.basename(startFile.path),
        depth: 0,
        fileType: startFile.type,
        empty: await isEmpty(startFile),
        prune: false,
        print: false,
      };
      const matches = evaluate(expr, ctx);
      let shouldPrint = matches;
      if (explicitPrint) shouldPrint = ctx.print;
      if (shouldPrint) {
        results.push(displayStart);
      }
      if (ctx.prune) return results;
    }

    if (startFile.type !== 'folder') return results;

    // 子要素を取得
    const files: ProjectFile[] = await this.getDescendants(startPath);

    files.sort((a, b) => a.path.localeCompare(b.path));

    for (const file of files) {
      const relativeToStart = posixPath.relative(startPath, file.path);
      const depth = relativeToStart === '' ? 0 : relativeToStart.split('/').length;

      if (depth < minDepth || depth > maxDepth) continue;

      const fullPath = displayPathForOperand(operand, startPath, file.path);

      // pruneチェック
      let isPruned = false;
      for (const p of pruned) {
        if (fullPath.startsWith(`${p}/`)) {
          isPruned = true;
          break;
        }
      }
      if (isPruned) continue;

      const ctx: FindContext = {
        file,
        fullPath,
        baseName: posixPath.basename(file.path),
        depth,
        fileType: file.type,
        empty: await isEmpty(file),
        prune: false,
        print: false,
      };

      const matches = evaluate(expr, ctx);
      if (file.type === 'folder' && ctx.prune) {
        pruned.add(fullPath);
      }

      let shouldPrint = matches;
      if (explicitPrint) shouldPrint = ctx.print;
      if (shouldPrint) {
        results.push(fullPath);
      }
    }

    return results;
  }

  private async getLinkAwareFile(path: string): Promise<ProjectFile | undefined> {
    try {
      return await this.fs.lstat(path);
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }
}
