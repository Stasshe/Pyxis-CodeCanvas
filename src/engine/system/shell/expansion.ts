import type { FsApi } from '@/engine/core/fs/index';
import { basename, resolvePath } from '@/engine/core/paths';
import { FNM_PATHNAME, FNM_PERIOD, fnmatch } from '../../core/fs/fnmatch';
import type { WordPart } from './types';

/**
 * Word expansion utilities for shell
 * Handles IFS splitting, glob expansion, and brace expansion
 */

/**
 * Check if a string contains glob characters
 */
export function hasGlob(s: string): boolean {
  for (let index = 0; index < s.length; index++) {
    if (s[index] === '\\') {
      index++;
      continue;
    }
    if ('*?['.includes(s[index])) return true;
  }
  return false;
}

interface Field {
  text: string;
  pattern: string;
}

function splitParts(parts: WordPart[], ifs: string): Field[] {
  const fields: Field[] = [];
  let current: Field = { text: '', pattern: '' };
  let active = false;
  let previousNonWhitespace = false;
  let previousWhitespace = false;
  let fieldsInValue = 0;
  const finish = () => {
    fields.push(current);
    fieldsInValue++;
    current = { text: '', pattern: '' };
    active = false;
  };
  const splitSeparator = (character: string) => {
    if (' \t\n'.includes(character)) {
      if (active) finish();
      previousWhitespace = true;
      previousNonWhitespace = false;
      return;
    }
    if (active || previousNonWhitespace || (fieldsInValue === 0 && !previousWhitespace)) finish();
    previousNonWhitespace = true;
    previousWhitespace = false;
  };
  for (const part of parts) {
    if (part.boundary) {
      // Unquoted multiple expansions use the first IFS character between values.
      const separator = ifs[0];
      if (separator !== undefined) splitSeparator(separator);
      else {
        if (active || part.quoted) finish();
        previousNonWhitespace = false;
        previousWhitespace = false;
      }
      fieldsInValue = 0;
    }
    if (part.text === '' && part.quoted) active = true;
    for (const character of part.text) {
      if (part.split && ifs.includes(character)) {
        splitSeparator(character);
        continue;
      }
      active = true;
      previousNonWhitespace = false;
      previousWhitespace = false;
      current.text += character;
      if ((part.quoted && '*?['.includes(character)) || character === '\\') current.pattern += '\\';
      current.pattern += character;
    }
  }
  if (active) finish();
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
  const separators = pattern.match(/\/+/g) ?? [];
  let leadingSeparator = '';
  if (pattern.startsWith('/') && separators[0] !== undefined) leadingSeparator = separators[0];
  let trailingSeparator = '';
  if (pattern.endsWith('/') && separators[separators.length - 1] !== undefined) {
    trailingSeparator = separators[separators.length - 1];
  }
  const absolute = leadingSeparator !== '';
  const directoryOnly = pattern.endsWith('/');
  const components = pattern.split('/').filter(Boolean);
  let startPath = options.cwd;
  if (absolute) startPath = '/';
  let matches = [{ path: startPath, display: leadingSeparator }];

  for (const [index, component] of components.entries()) {
    let separator = '';
    if (index > 0) {
      let separatorIndex = index - 1;
      if (absolute) separatorIndex = index;
      separator = separators[separatorIndex];
    }
    const next: typeof matches = [];
    for (const current of matches) {
      if (!hasGlob(component)) {
        const literal = component.replace(/\\(.)/g, '$1');
        const path = resolvePath(current.path, literal);
        if (await options.fsClient.exists(path)) {
          next.push({ path, display: appendPath(current.display, literal, separator) });
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
              display: appendPath(current.display, name, separator),
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

  if (directoryOnly) {
    const directories = [];
    for (const match of matches) {
      try {
        if ((await options.fsClient.stat(match.path)).type === 'folder') {
          directories.push({ ...match, display: `${match.display}${trailingSeparator}` });
        }
      } catch {
        // A dangling symlink is not a directory match.
      }
    }
    if (directories.length === 0) return [pattern];
    matches = directories;
  }

  return matches.map(match => match.display).sort(compareUtf8);
}

function appendPath(parent: string, child: string, separator: string): string {
  let joiner = separator;
  if (joiner === '' && parent !== '' && !parent.endsWith('/')) joiner = '/';
  return `${parent}${joiner}${child}`;
}

function compareUtf8(left: string, right: string): number {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index++) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

function patternHasGlob(components: string[]): boolean {
  return components.some(hasGlob);
}

/**
 * Expand tokens with IFS splitting, brace expansion, and glob expansion
 */
export async function expandTokens(
  tokens: WordPart[][],
  options: GlobExpandOptions
): Promise<string[]> {
  const ifs = options.env.IFS ?? ' \t\n';

  const finalWords: string[] = [];

  for (const parts of tokens) {
    for (const field of splitParts(parts, ifs)) {
      if (!hasGlob(field.pattern)) {
        finalWords.push(field.text);
        continue;
      }
      const matches = await globExpand(field.pattern, options);
      if (matches.length === 1 && matches[0] === field.pattern) finalWords.push(field.text);
      else finalWords.push(...matches);
    }
  }

  return finalWords;
}
