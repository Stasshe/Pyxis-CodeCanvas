import type { FsApi } from '@/engine/core/fs';
import { basename, resolvePath } from '@/engine/core/pathUtils';
import { FNM_PATHNAME, FNM_PERIOD, fnmatch } from '../lib/fnmatch';
import expandBraces from './braceExpand';
import type { TokenObj } from './types';

/**
 * Word expansion utilities for shell
 * Handles IFS splitting, glob expansion, and brace expansion
 */

/**
 * Check if a string contains glob characters
 */
export function hasGlob(s: string): boolean {
  return /[*?[]/.test(s);
}

/**
 * Split on IFS (Internal Field Separator)
 */
export function splitOnIFS(s: string, ifs?: string): string[] {
  if (!s) return [''];
  const ifsValue = ifs ?? ' \t\n';
  if (ifsValue === '') return [s];

  const whitespace = new Set(Array.from(ifsValue).filter(char => /[ \t\n]/.test(char)));
  const separators = new Set(Array.from(ifsValue));
  const fields: string[] = [];
  let field = '';
  let previousWasNonWhitespaceSeparator = false;

  for (const character of s) {
    if (!separators.has(character)) {
      field += character;
      previousWasNonWhitespaceSeparator = false;
      continue;
    }

    if (whitespace.has(character)) {
      if (field) {
        fields.push(field);
        field = '';
      }
      continue;
    }

    if (field) fields.push(field);
    else if (previousWasNonWhitespaceSeparator || fields.length === 0) fields.push('');
    field = '';
    previousWasNonWhitespaceSeparator = true;
  }

  if (field) fields.push(field);
  return fields;
}

/**
 * Glob expansion options
 */
export interface GlobExpandOptions {
  rootPath: string;
  cwd: string;
  fsClient: FsApi;
  env: Record<string, string>;
}

/**
 * Expand glob pattern to matching file paths
 */
export async function globExpand(pattern: string, options: GlobExpandOptions): Promise<string[]> {
  const absolute = pattern.startsWith('/');
  const components = pattern.split('/').filter(Boolean);
  let matches = [{ path: absolute ? '/' : options.cwd, display: absolute ? '/' : '' }];

  for (const component of components) {
    const next: typeof matches = [];
    for (const current of matches) {
      if (!hasGlob(component)) {
        const path = resolvePath(current.path, component);
        if (await options.fsClient.exists(path)) {
          next.push({ path, display: appendPath(current.display, component, absolute) });
        }
        continue;
      }

      try {
        const entries = await options.fsClient.readdir(current.path);
        for (const entry of entries) {
          const name = basename(entry.path);
          if (fnmatch(component, name, FNM_PERIOD | FNM_PATHNAME) === 0) {
            next.push({
              path: entry.path,
              display: appendPath(current.display, name, absolute),
            });
          }
        }
      } catch {
        // An unreadable directory has no glob matches.
      }
    }
    matches = next;
    if (matches.length === 0) return [pattern];
  }

  if (components.length === 0 || !patternHasGlob(components)) return [pattern];
  return matches.map(match => match.display).sort();
}

function appendPath(parent: string, child: string, absolute: boolean): string {
  if (parent === '/') return `/${child}`;
  if (parent === '') return absolute ? `/${child}` : child;
  return `${parent}/${child}`;
}

function patternHasGlob(components: string[]): boolean {
  return components.some(hasGlob);
}

/**
 * Expand tokens with IFS splitting, brace expansion, and glob expansion
 */
export async function expandTokens(
  tokens: TokenObj[],
  options: GlobExpandOptions
): Promise<string[]> {
  const homePath = options.env.HOME;
  const ifs = options.env.IFS ?? ' \t\n';

  const finalWords: string[] = [];

  for (const tk of tokens) {
    if (tk.quote === 'single' || tk.quote === 'double') {
      // quoted: no field splitting, no globbing
      finalWords.push(tk.text);
      continue;
    }
    // Unquoted words receive tilde, field, brace, and glob expansion once.
    let parts: string[];
    if (homePath && tk.text === '~') parts = [homePath];
    else if (homePath && tk.text.startsWith('~/')) parts = [`${homePath}${tk.text.slice(1)}`];
    else parts = splitOnIFS(tk.text, ifs);
    for (const p of parts) {
      if (p === '') continue;
      // brace expansion
      const bexp = expandBraces(p);
      if (bexp.length > 1 || bexp[0] !== p) {
        for (const bp of bexp) {
          if (hasGlob(bp) && bp !== '') {
            const matches = await globExpand(bp, options);
            for (const m of matches) finalWords.push(m);
          } else if (bp !== '') {
            finalWords.push(bp);
          }
        }
        continue;
      }
      if (hasGlob(p) && p !== '') {
        const matches = await globExpand(p, options);
        for (const m of matches) finalWords.push(m);
      } else if (p !== '') {
        finalWords.push(p);
      }
    }
  }

  return finalWords;
}
