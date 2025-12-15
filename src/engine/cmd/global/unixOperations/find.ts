import { UnixCommandBase } from './base';

import type { ProjectFile } from '@/types';

/**
 * find - ファイルを検索
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
 *
 * 例:
 *   find . -name "*.js"
 *   find . -iname readme
 *   find /projects/myapp -type f -name "*.ts"
 */
export class FindCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    // ...existing code...

    // パスと式を分離
    const paths: string[] = [];
    let expressionStart = 0;

    for (let i = 0; i < args.length; i++) {
      if (args[i].startsWith('-')) {
        expressionStart = i;
        break;
      }
      paths.push(args[i]);
    }

    // デフォルトはカレントディレクトリ
    if (paths.length === 0) paths.push(this.currentDir);

    const expressions = args.slice(expressionStart);

    // 式を解析
    const criteria = this.parseExpressions(expressions);

    const results: string[] = [];

    // 各パスに対して検索実行
    for (const p of paths) {
      const normalizedPath = this.normalizePath(this.resolvePath(p));
      const found = await this.findFiles(normalizedPath, criteria);
      results.push(...found);
    }

    // 重複除去しつつ順序を保持
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

  /**
   * 検索式を解析して条件オブジェクトを返す
   */
  protected parseExpressions(expressions: string[]): SearchCriteria {
    const criteria: SearchCriteria = {
      namePattern: null,
      pathPattern: null,
      typeFilter: null,
      maxDepth: Number.MAX_SAFE_INTEGER,
      minDepth: 0,
    };

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i];
      const nextArg = expressions[i + 1];

      switch (expr) {
        case '-name':
          if (nextArg) {
            criteria.namePattern = this.globToRegExp(nextArg, false);
            i++;
          }
          break;

        case '-iname':
          if (nextArg) {
            criteria.namePattern = this.globToRegExp(nextArg, true);
            i++;
          }
          break;

        case '-path':
          if (nextArg) {
            criteria.pathPattern = this.globToRegExp(nextArg, false);
            i++;
          }
          break;

        case '-ipath':
          if (nextArg) {
            criteria.pathPattern = this.globToRegExp(nextArg, true);
            i++;
          }
          break;

        case '-type':
          if (nextArg) {
            if (nextArg === 'f') criteria.typeFilter = 'file';
            else if (nextArg === 'd') criteria.typeFilter = 'folder';
            i++;
          }
          break;

        case '-maxdepth':
          if (nextArg) {
            const depth = Number.parseInt(nextArg, 10);
            if (!isNaN(depth) && depth >= 0) {
              criteria.maxDepth = depth;
            }
            i++;
          }
          break;

        case '-mindepth':
          if (nextArg) {
            const depth = Number.parseInt(nextArg, 10);
            if (!isNaN(depth) && depth >= 0) {
              criteria.minDepth = depth;
            }
            i++;
          }
          break;
      }
    }

    return criteria;
  }

  /**
   * glob パターンを正規表現に変換
   *
   * サポートするパターン:
   *   * : 任意の文字列（0文字以上）
   *   ? : 任意の1文字
   *   [abc] : a, b, c のいずれか
   *   [!abc] または [^abc] : a, b, c 以外
   *
   * @param pattern - globパターン
   * @param ignoreCase - 大文字小文字を区別しない場合true
   */
  private globToRegExp(pattern: string, ignoreCase = false): RegExp {
    // POSIX: ワイルドカードなしは完全一致（basenameのみ）
    if (!pattern.includes('*') && !pattern.includes('?') && !pattern.includes('[')) {
      // 例: find . -iname readme → basenameが"readme"のみ一致
      return new RegExp(
        '^' + pattern.replace(/[.+^${}()|\[\]]/g, '\\$&') + '$',
        ignoreCase ? 'i' : ''
      );
    }
    // ワイルドカードありはglob展開
    let res = '';
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*') {
        res += '.*';
        i++;
      } else if (ch === '?') {
        res += '.';
        i++;
      } else if (ch === '[') {
        let j = i + 1;
        let cls = '';
        if (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^')) {
          cls += '^';
          j++;
        }
        while (j < pattern.length && pattern[j] !== ']') {
          const c = pattern[j];
          if (c === '\\' && j + 1 < pattern.length) {
            cls += '\\';
            j++;
            cls += pattern[j];
            j++;
          } else if (c === ']') {
            break;
          } else {
            if (c === '-' || c === '\\') {
              cls += '\\' + c;
            } else {
              cls += c;
            }
            j++;
          }
        }
        res += '[' + cls + ']';
        i = j + 1;
      } else if (ch === '\\' && i + 1 < pattern.length) {
        const nextCh = pattern[i + 1];
        if (/[.+^${}()|\[\]]/.test(nextCh)) {
          res += '\\' + nextCh;
        } else {
          res += nextCh;
        }
        i += 2;
      } else {
        if (/[.+^${}()|\[\]]/.test(ch)) {
          res += '\\' + ch;
        } else {
          res += ch;
        }
        i++;
      }
    }
    // basename完全一致
    return new RegExp('^' + res + '$', ignoreCase ? 'i' : '');
  }

  /**
   * 指定されたパスからファイルを検索
   */
  protected async findFiles(startPath: string, criteria: SearchCriteria): Promise<string[]> {
    const relativePath = this.getRelativePathFromProject(startPath);
    const results: string[] = [];
    const normalizedStart = startPath.endsWith('/') ? startPath.slice(0, -1) : startPath;

    // 開始パス自体をチェック（depth 0）
    const startFile = await this.cachedGetFile(relativePath);
    if (startFile) {
      // 深度チェック
      if (0 >= criteria.minDepth && 0 <= criteria.maxDepth) {
        if (this.matchesCriteria(startFile, normalizedStart, 0, criteria)) {
          results.push(normalizedStart);
        }
      }
    }

    // 子要素を取得して検索
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);

    // POSIX準拠: prefix以下の全ファイル・ディレクトリを再帰的に検索
    for (const file of files) {
      let relativeToStart = file.path.startsWith(prefix)
        ? file.path.substring(prefix.length)
        : file.path;
      relativeToStart = relativeToStart.replace(/^\/+/, '');

      // 深度を計算
      const depth = relativeToStart === '' ? 0 : relativeToStart.split('/').filter(p => p).length;

      // 深度チェック
      if (depth < criteria.minDepth || depth > criteria.maxDepth) {
        continue;
      }

      // フルパスを構築
      const fullPath =
        relativeToStart === '' ? normalizedStart : `${normalizedStart}/${relativeToStart}`;

      // POSIX: type指定がなければ全type対象、name指定もfile/folder両方
      if (criteria.typeFilter && file.type !== criteria.typeFilter) {
        continue;
      }

      // 条件に一致するかチェック（AND結合）
      if (this.matchesCriteria(file, fullPath, depth, criteria)) {
        results.push(fullPath);
      }
    }

    return results;
  }

  /**
   * ファイルが検索条件に一致するかチェック
   */
  private matchesCriteria(
    file: ProjectFile,
    fullPath: string,
    depth: number,
    criteria: SearchCriteria
  ): boolean {
    // basename は ProjectFile の name プロパティを使う
    const baseName = file.name || '';
    // AND条件で全てのcriteriaを判定
    // -name/-iname: type指定なしならfile/folder両方
    if (criteria.namePattern) {
      if (!criteria.namePattern.test(baseName)) {
        return false;
      }
    }
    // -path/-ipath
    if (criteria.pathPattern) {
      if (!criteria.pathPattern.test(fullPath)) {
        return false;
      }
    }
    // -type
    if (criteria.typeFilter) {
      if (file.type !== criteria.typeFilter) {
        return false;
      }
    }
    return true;
  }
}

/**
 * 検索条件の型定義
 */
interface SearchCriteria {
  namePattern: RegExp | null;
  pathPattern: RegExp | null;
  typeFilter: 'file' | 'folder' | null;
  maxDepth: number;
  minDepth: number;
}
