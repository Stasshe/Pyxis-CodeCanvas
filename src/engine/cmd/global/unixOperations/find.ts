import { UnixCommandBase } from './base';

import type { ProjectFile } from '@/types';

// Single, clean implementation of FindCommand
export class FindCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    const { positional } = this.parseOptions(args);

    const paths: string[] = [];
    let exprStart = positional.length;
    for (let i = 0; i < positional.length; i++) {
      if (positional[i].startsWith('-')) {
        exprStart = i;
        break;
      }
      paths.push(positional[i]);
    }
    if (paths.length === 0) paths.push(this.currentDir);

    const expressions = positional.slice(exprStart);

    let namePattern: RegExp | null = null;
    let pathPattern: RegExp | null = null;
    let typeFilter: 'file' | 'folder' | null = null;
    let maxDepth = Number.MAX_SAFE_INTEGER;
    let minDepth = 0;

    for (let i = 0; i < expressions.length; i++) {
      const e = expressions[i];
      if ((e === '-name' || e === '-iname') && i + 1 < expressions.length) {
        namePattern = this.globToRegExp(expressions[i + 1], e === '-iname');
        i++;
      } else if ((e === '-path' || e === '-ipath') && i + 1 < expressions.length) {
        pathPattern = this.globToRegExp(expressions[i + 1], e === '-ipath');
        i++;
      } else if (e === '-type' && i + 1 < expressions.length) {
        const t = expressions[i + 1];
        if (t === 'f') typeFilter = 'file';
        else if (t === 'd') typeFilter = 'folder';
        i++;
      } else if (e === '-maxdepth' && i + 1 < expressions.length) {
        maxDepth = parseInt(expressions[i + 1], 10) || Number.MAX_SAFE_INTEGER;
        i++;
      } else if (e === '-mindepth' && i + 1 < expressions.length) {
        minDepth = parseInt(expressions[i + 1], 10) || 0;
        i++;
      }
    }

    const allResults: string[] = [];
    for (const p of paths) {
      const abs = this.normalizePath(this.resolvePath(p));
      const found = await this.findFiles(abs, namePattern, pathPattern, typeFilter, maxDepth, minDepth);
      allResults.push(...found);
    }

    // remove duplicates while preserving order
    const seen = new Set<string>();
    const out: string[] = [];
    for (const r of allResults) {
      if (!seen.has(r)) {
        seen.add(r);
        out.push(r);
      }
    }

    return out.join('\n');
  }

  private globToRegExp(pattern: string, ignoreCase = false): RegExp {
    let out = '^';
    let i = 0;
    while (i < pattern.length) {
      const ch = pattern[i];
      if (ch === '*') out += '.*';
      else if (ch === '?') out += '.';
      else if (ch === '[') {
        let j = i + 1;
        let cls = '';
        if (j < pattern.length && (pattern[j] === '!' || pattern[j] === '^')) {
          cls += '^';
          j++;
        }
        while (j < pattern.length && pattern[j] !== ']') {
          const c = pattern[j++];
          if (c === '\\') cls += '\\\\';
          else cls += c.replace(/([\\\]])/g, '\\$1');
        }
        out += '[' + cls + ']';
        while (i < pattern.length && pattern[i] !== ']') i++;
      } else {
        out += ch.replace(/[.*+?^${}()|[\\]\\]/g, m => '\\' + m);
      }
      i++;
    }
    out += '$';
    return new RegExp(out, ignoreCase ? 'i' : '');
  }

  private joinNoDoubleSlash(a: string, b: string): string {
    if (!b) return a.replace(/\/+$|$/, '');
    return (a.replace(/\/+$/g, '') + '/' + b.replace(/^\/+/, '')).replace(/\/+/, '/').replace(/\/+/g, '/');
  }

  private async findFiles(
    startAbsPath: string,
    namePattern: RegExp | null,
    pathPattern: RegExp | null,
    typeFilter: 'file' | 'folder' | null,
    maxDepth: number,
    minDepth: number
  ): Promise<string[]> {
    const results: string[] = [];

    const relativeStart = this.getRelativePathFromProject(startAbsPath);
    const normalizedStart = startAbsPath.replace(/\/+$/g, '');

    // check start itself
    const startFile = await this.cachedGetFile(relativeStart);
    if (startFile) {
      const d0 = 0;
      if (d0 >= minDepth && d0 <= maxDepth) {
        const base = startFile.path.split('/').pop() || '';
        const nameOk = namePattern ? namePattern.test(base) : true;
        const pathOk = pathPattern ? pathPattern.test(normalizedStart) : true;
        const typeOk = typeFilter ? startFile.type === typeFilter : true;
        if (nameOk && pathOk && typeOk) results.push(normalizedStart);
      }
    }

    const prefix = relativeStart === '/' ? '' : `${relativeStart}/`;
    const files: ProjectFile[] = await this.cachedGetFilesByPrefix(prefix);

    for (const file of files) {
      let relativeToStart: string;
      if (prefix === '') relativeToStart = file.path.replace(/^\/+/, '');
      else if (file.path.startsWith(prefix)) relativeToStart = file.path.substring(prefix.length);
      else continue;

      const depth = relativeToStart === '' ? 0 : relativeToStart.split('/').filter(Boolean).length;
      if (depth < minDepth || depth > maxDepth) continue;

      const fullPath = relativeToStart === '' ? normalizedStart : this.joinNoDoubleSlash(normalizedStart, relativeToStart);
      const base = file.path.split('/').pop() || '';
      const nameOk = namePattern ? namePattern.test(base) : true;
      const pathOk = pathPattern ? pathPattern.test(fullPath) : true;
      const typeOk = typeFilter ? file.type === typeFilter : true;
      if (nameOk && pathOk && typeOk) results.push(fullPath);
    }

    return results;
  }
}





