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
 *   -maxdepth N
 *   -mindepth N
 */
export class FindCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { positional } = this.parseOptions(args);

    // パスと式を分離
    const paths: string[] = [];
    let expressionStart = 0;

    for (let i = 0; i < positional.length; i++) {
      if (positional[i].startsWith('-')) {
        expressionStart = i;
        break;
      }
      paths.push(positional[i]);
    }

    if (paths.length === 0) paths.push(this.currentDir);

    const expressions = positional.slice(expressionStart);

    // 式を解析
    let namePattern: RegExp | null = null;
    let pathPattern: RegExp | null = null;
    let typeFilter: 'file' | 'folder' | null = null;
    let maxDepth = Number.MAX_SAFE_INTEGER;
    let minDepth = 0;

    for (let i = 0; i < expressions.length; i++) {
      const expr = expressions[i];
      if (expr === '-name' && i + 1 < expressions.length) {
        namePattern = this.globToRegExp(expressions[i + 1], false);
        i++;
      } else if (expr === '-iname' && i + 1 < expressions.length) {
        namePattern = this.globToRegExp(expressions[i + 1], true);
        i++;
      } else if (expr === '-path' && i + 1 < expressions.length) {
        pathPattern = this.globToRegExp(expressions[i + 1], false);
        i++;
      } else if (expr === '-ipath' && i + 1 < expressions.length) {
        pathPattern = this.globToRegExp(expressions[i + 1], true);
        i++;
      } else if (expr === '-type' && i + 1 < expressions.length) {
        const t = expressions[i + 1];
        if (t === 'f') typeFilter = 'file';
        else if (t === 'd') typeFilter = 'folder';
        i++;
      } else if (expr === '-maxdepth' && i + 1 < expressions.length) {
        maxDepth = parseInt(expressions[i + 1], 10) || Number.MAX_SAFE_INTEGER;
        i++;
      } else if (expr === '-mindepth' && i + 1 < expressions.length) {
        minDepth = parseInt(expressions[i + 1], 10) || 0;
        i++;
      }
    }

    const results: string[] = [];

    for (const p of paths) {
      const normalizedPath = this.normalizePath(this.resolvePath(p));
      const found = await this.findFiles(
        normalizedPath,
        namePattern,
        pathPattern,
        typeFilter,
        maxDepth,
        minDepth
      );
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
   * glob を RegExp に変換（basename か path のどちらでも利用可）
   */
  private globToRegExp(pattern: string, ignoreCase = false): RegExp {
    let i = 0;
    let res = '^';
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*') {
        res += '.*';
      } else if (ch === '?') {
        res += '.';
      } else if (ch === '[') {
        // character class
        let j = i + 1;
        let cls = '';
        if (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^')) {
          cls += '^';
          j++;
        }
        while (j < pattern.length && pattern[j] !== ']') {
          const c = pattern[j++];
          if (c === '\\') cls += '\\\\';
          else cls += c.replace(/([\\\]])/, '\\$1');
        }
        res += '[' + cls + ']';
        while (i < pattern.length && pattern[i] !== ']') i++;
      } else {
        res += ch.replace(/[.*+?^${}()|[\\]\\]/g, m => '\\' + m);
      }
      i++;
    }
    res += '$';
    return new RegExp(res, ignoreCase ? 'i' : '');
  }

  private async findFiles(
    startPath: string,
    namePattern: RegExp | null,
    pathPattern: RegExp | null,
    typeFilter: 'file' | 'folder' | null,
    maxDepth: number,
    minDepth: number
  ): Promise<string[]> {
    const relativePath = this.getRelativePathFromProject(startPath);
    const results: string[] = [];

    const normalizedStart = startPath.endsWith('/') ? startPath.slice(0, -1) : startPath;

    // startPath 自身をチェック
    const startFile = await this.cachedGetFile(relativePath);
    if (startFile) {
      const depth = 0;
      if (depth >= minDepth && depth <= maxDepth) {
        const baseName = startFile.path.split('/').pop() || '';
        const nameOk = namePattern ? namePattern.test(baseName) : true;
        const pathOk = pathPattern ? pathPattern.test(normalizedStart) : true;
        if (nameOk && pathOk && (!typeFilter || startFile.type === typeFilter)) {
          results.push(normalizedStart);
        }
      }
    }

    // prefix で子を取得
    const prefix = relativePath === '/' ? '' : `${relativePath}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);

    for (const file of files) {
      // relativeToStart を正規化（先頭スラッシュ除去）
      let relativeToStart = file.path.startsWith(prefix) ? file.path.substring(prefix.length) : file.path;
      relativeToStart = relativeToStart.replace(/^\/+/, '');

      const depth = relativeToStart === '' ? 0 : relativeToStart.split('/').filter(p => p).length;
      if (depth < minDepth || depth > maxDepth) continue;

      const fullPath = relativeToStart === '' ? normalizedStart : `${normalizedStart}/${relativeToStart}`;
      const baseName = file.path.split('/').pop() || '';
      const nameOk = namePattern ? namePattern.test(baseName) : true;
      const pathOk = pathPattern ? pathPattern.test(fullPath) : true;
      if (nameOk && pathOk && (!typeFilter || file.type === typeFilter)) {
        results.push(fullPath);
      }
    }

    return results;
  }
}