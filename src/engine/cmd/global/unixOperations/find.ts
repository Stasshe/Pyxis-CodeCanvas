import {
  type EvalContext,
  ExprBuilder,
  ExprParser,
  type Expression,
  FNM_CASEFOLD,
  FNM_PATHNAME,
  evaluate,
  fnmatch,
  fnmatchPath,
  parseArgs,
} from '../../lib';
import { UnixCommandBase } from './base';

import type { ProjectFile } from '@/types';

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
  fileType: 'file' | 'folder';
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
        if (!pattern) return ExprBuilder.true();
        return ExprBuilder.predicate('-name', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatch(pattern, fc.baseName) === 0;
        });
      }

      case '-iname': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) return ExprBuilder.true();
        return ExprBuilder.predicate('-iname', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatch(pattern, fc.baseName, FNM_CASEFOLD) === 0;
        });
      }

      case '-path':
      case '-wholename': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) return ExprBuilder.true();
        return ExprBuilder.predicate('-path', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatchPath(pattern, fc.fullPath, FNM_PATHNAME) === 0;
        });
      }

      case '-ipath':
      case '-iwholename': {
        this.stream.consume();
        const pattern = this.stream.consume();
        if (!pattern) return ExprBuilder.true();
        return ExprBuilder.predicate('-ipath', [pattern], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          return fnmatchPath(pattern, fc.fullPath, FNM_PATHNAME | FNM_CASEFOLD) === 0;
        });
      }

      case '-type': {
        this.stream.consume();
        const typeChar = this.stream.consume();
        if (!typeChar) return ExprBuilder.true();
        return ExprBuilder.predicate('-type', [typeChar], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          if (typeChar === 'f') return fc.fileType === 'file';
          if (typeChar === 'd') return fc.fileType === 'folder';
          return false;
        });
      }

      case '-empty': {
        this.stream.consume();
        return ExprBuilder.predicate('-empty', [], (ctx: EvalContext) => {
          const fc = ctx as FindContext;
          // ファイルの場合はサイズ0、ディレクトリの場合は空
          if (fc.fileType === 'file') {
            return (fc.file.content?.length || 0) === 0;
          }
          return false; // ディレクトリの空判定は別途実装が必要
        });
      }

      case '-prune': {
        this.stream.consume();
        // pruneは特殊: 常にtrueを返すが、副作用としてディレクトリをスキップ
        const pred = ExprBuilder.predicate('-prune', [], () => true);
        (pred as any).isPrune = true;
        return pred;
      }

      case '-print': {
        this.stream.consume();
        return ExprBuilder.predicate('-print', [], () => true);
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
        // 未知のオプションはスキップ
        if (tok.startsWith('-')) {
          this.stream.consume();
          const next = this.stream.peek();
          if (
            next &&
            !next.startsWith('-') &&
            !this.isOpenGroup(next) &&
            !this.isCloseGroup(next)
          ) {
            this.stream.consume();
          }
          return null;
        }
        return null;
    }
  }
}

/**
 * pruneすべきかチェック
 */
function shouldPrune(expr: Expression | null, ctx: FindContext): boolean {
  if (!expr) return false;

  switch (expr.kind) {
    case 'predicate':
      // -pruneを含み、その条件が真ならprune
      if ((expr as any).isPrune) {
        return true;
      }
      return false;

    case 'and':
      // 左辺が真で右辺がpruneならprune
      if (evaluate(expr.left as Expression, ctx)) {
        return shouldPrune(expr.right as Expression, ctx);
      }
      return false;

    case 'or':
      return (
        shouldPrune(expr.left as Expression, ctx) || shouldPrune(expr.right as Expression, ctx)
      );

    case 'not':
      return false;

    default:
      return false;
  }
}

export class FindCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    // --help support
    if (args.includes('--help') || args.includes('-h')) {
      return `Usage: find [path...] [expression]\n\nSearch for files in a directory hierarchy. See man/find for supported expressions and predicates.`;
    }

    // パスと式を分離
    const paths: string[] = [];
    let exprStart = 0;

    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
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
        const d = Number.parseInt(args[++i], 10);
        if (!Number.isNaN(d) && d >= 0) maxDepth = d;
      } else if (arg === '-mindepth' && i + 1 < args.length) {
        const d = Number.parseInt(args[++i], 10);
        if (!Number.isNaN(d) && d >= 0) minDepth = d;
      } else {
        exprTokens.push(arg);
      }
    }

    // 式をパース
    const parser = new FindExprParser(exprTokens);
    const expr = parser.parse() as Expression | null;

    const results: string[] = [];

    for (const p of paths) {
      const normalizedPath = this.normalizePath(this.resolvePath(p));
      const found = await this.findFiles(normalizedPath, expr, maxDepth, minDepth);
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
    startPath: string,
    expr: Expression | null,
    maxDepth: number,
    minDepth: number
  ): Promise<string[]> {
    const relativePath = this.getRelativePathFromProject(startPath);
    const results: string[] = [];
    const normalizedStart = startPath.endsWith('/') ? startPath.slice(0, -1) : startPath;
    const pruned = new Set<string>();

    // 開始パス自体をチェック
    const startFile = await this.cachedGetFile(relativePath);
    if (startFile && 0 >= minDepth && 0 <= maxDepth) {
      const ctx: FindContext = {
        file: startFile,
        fullPath: normalizedStart,
        baseName: startFile.name || '',
        depth: 0,
        fileType: startFile.type as 'file' | 'folder',
      };
      if (evaluate(expr, ctx)) {
        results.push(normalizedStart);
      }
    }

    // 子要素を取得
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);

    files.sort((a, b) => a.path.localeCompare(b.path));

    for (const file of files) {
      let relativeToStart = file.path.startsWith(prefix)
        ? file.path.substring(prefix.length)
        : file.path;
      relativeToStart = relativeToStart.replace(/^\/+/, '');

      const depth = relativeToStart === '' ? 0 : relativeToStart.split('/').filter(p => p).length;

      if (depth < minDepth || depth > maxDepth) continue;

      const fullPath =
        relativeToStart === '' ? normalizedStart : `${normalizedStart}/${relativeToStart}`;

      // pruneチェック
      let isPruned = false;
      for (const p of pruned) {
        if (fullPath.startsWith(p + '/')) {
          isPruned = true;
          break;
        }
      }
      if (isPruned) continue;

      const ctx: FindContext = {
        file,
        fullPath,
        baseName: file.name || '',
        depth,
        fileType: file.type as 'file' | 'folder',
      };

      // pruneチェック
      if (file.type === 'folder' && shouldPrune(expr, ctx)) {
        pruned.add(fullPath);
        continue;
      }

      if (evaluate(expr, ctx)) {
        results.push(fullPath);
      }
    }

    return results;
  }
}
