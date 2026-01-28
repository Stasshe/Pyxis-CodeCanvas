import type { fileRepository } from '@/engine/core/fileRepository';
import type { UnixCommands } from '../global/unix';
import type { TokenObj } from './types';
import type { ProjectFile } from '@/types';

import expandBraces from './braceExpand';

/**
 * Word expansion utilities for shell
 * Handles IFS splitting, glob expansion, and brace expansion
 */

/**
 * Check if a string contains glob characters
 */
export function hasGlob(s: string): boolean {
  return /[*?\[]/.test(s);
}

/**
 * Escape characters for use in a character class
 */
function escapeForCharClass(ch: string): string {
  if (ch === '\\') return '\\\\';
  if (ch === ']') return '\\]';
  if (ch === '-') return '\\-';
  if (ch === '^') return '\\^';
  return ch.replace(/([\\\]\-\^])/g, m => `\\${m}`);
}

/**
 * Split on IFS (Internal Field Separator)
 */
export function splitOnIFS(s: string, ifs?: string): string[] {
  if (!s) return [''];
  const ifsValue = (ifs ?? ' \t\n').replace(/\\t/g, '\t').replace(/\\n/g, '\n');
  const isIfsWhitespace = /[ \t\n]/.test(ifsValue);

  if (isIfsWhitespace) {
    // treat runs of whitespace as single separator and trim edges
    return s.split(/\s+/).filter(Boolean);
  }
  // split on any IFS char, preserve empty fields
  const chars = Array.from(new Set(ifsValue.split('')))
    .map(c => escapeForCharClass(c))
    .join('');
  const re = new RegExp(`[${chars}]`);
  return s.split(re).filter(x => x !== undefined);
}

/**
 * Glob expansion options
 */
export interface GlobExpandOptions {
  projectId: string;
  projectName: string;
  fileRepository?: typeof fileRepository;
  unix?: UnixCommands;
}

/**
 * Expand glob pattern to matching file paths
 */
export async function globExpand(pattern: string, options: GlobExpandOptions): Promise<string[]> {
  const { projectId, projectName, fileRepository: repo, unix } = options;

  if (!repo || !unix) return [pattern];

  try {
    const currentWorkingDir = await unix.pwd().catch(() => `/projects/${projectName}`);
    const projectBase = `/projects/${projectName}`;

    // Split pattern into directory prefix and filename glob
    const lastSlashIndex = pattern.lastIndexOf('/');
    const dirPrefix = lastSlashIndex >= 0 ? pattern.slice(0, lastSlashIndex + 1) : '';
    const fileGlob = lastSlashIndex >= 0 ? pattern.slice(lastSlashIndex + 1) : pattern;

    // Resolve dirPrefix into a normalized absolute project path
    let resolvedTargetDir: string;
    if (dirPrefix.startsWith('/')) {
      resolvedTargetDir = projectBase + dirPrefix;
    } else if (dirPrefix === '') {
      const resolvedCwd = await unix.pwd().catch(() => projectBase);
      resolvedTargetDir = resolvedCwd;
    } else {
      const resolvedCwd = await unix.pwd().catch(() => projectBase);
      let combined = resolvedCwd === '/' ? `/${dirPrefix}` : `${resolvedCwd}/${dirPrefix}`;
      combined = combined.replace(/\/+/g, '/');
      const parts = combined.split('/').filter(p => p !== '' && p !== '.');
      const stack: string[] = [];
      for (const part of parts) {
        if (part === '..') {
          if (stack.length > 0) stack.pop();
        } else {
          stack.push(part);
        }
      }
      resolvedTargetDir = `/${stack.join('/')}`;
    }

    // Convert resolvedTargetDir into a project-relative prefix
    let projectRelativeDir: string;
    if (resolvedTargetDir === projectBase || resolvedTargetDir === `${projectBase}/`) {
      projectRelativeDir = '';
    } else if (resolvedTargetDir.startsWith(projectBase)) {
      projectRelativeDir = resolvedTargetDir.substring(projectBase.length);
    } else {
      projectRelativeDir = resolvedTargetDir;
    }

    const searchPrefix =
      projectRelativeDir === '' || projectRelativeDir === '/'
        ? ''
        : projectRelativeDir.endsWith('/')
          ? projectRelativeDir
          : `${projectRelativeDir}/`;

    let projectFiles: ProjectFile[] = [];
    if (repo.getFilesByPrefix) {
      projectFiles = await repo.getFilesByPrefix(projectId, searchPrefix);
    }

    // Filter files to direct children under the target directory only
    const directChildren = projectFiles.filter((file: any) => {
      if (searchPrefix === '') {
        const parts = file.path.split('/').filter((p: string) => p);
        return parts.length === 1;
      }
      const prefix = searchPrefix + (searchPrefix.endsWith('/') ? '' : '/');
      if (!file.path.startsWith(prefix)) return false;
      const remainder = file.path.substring(prefix.length);
      return !remainder.includes('/');
    });

    const fileNames = directChildren
      .map((file: any) => file.path.split('/').pop() || '')
      .filter((n: string) => n !== '');

    // Build regex from glob pattern
    const regexParts: string[] = [];
    for (let i = 0; i < fileGlob.length; i++) {
      const ch = fileGlob[i];
      if (ch === '*') regexParts.push('[^/]*');
      else if (ch === '?') regexParts.push('[^/]');
      else if (ch === '[') {
        let j = i + 1;
        let cls = '';
        while (j < fileGlob.length && fileGlob[j] !== ']') {
          const c = fileGlob[j++];
          if (c === '\\' || c === ']' || c === '-') cls += `\\${c}`;
          else cls += c;
        }
        i = Math.min(j, fileGlob.length - 1);
        regexParts.push(`[${cls}]`);
      } else if (/[\\.\+\^\$\{\}\(\)\|]/.test(ch)) regexParts.push(`\\${ch}`);
      else regexParts.push(ch);
    }

    const regexStr = `^${regexParts.join('')}$`;
    const regex = new RegExp(regexStr);
    const matchedNames = fileNames.filter((n: string) => regex.test(n)).sort();

    console.log('[globExpand] input:', pattern);
    console.log('[globExpand] cwd:', currentWorkingDir);
    console.log('[globExpand] dirPrefix:', dirPrefix, 'fileGlob:', fileGlob);
    console.log('[globExpand] matched:', matchedNames);

    if (matchedNames.length > 0) {
      return matchedNames.map(name => dirPrefix + name);
    }
  } catch (e) {
    console.warn('[globExpand] failed:', e);
  }

  return [pattern];
}

/**
 * Expand tokens with IFS splitting, brace expansion, and glob expansion
 */
export async function expandTokens(
  tokens: TokenObj[],
  options: GlobExpandOptions
): Promise<string[]> {
  const ifs = (process.env.IFS ?? ' \t\n').replace(/\\t/g, '\t').replace(/\\n/g, '\n');

  const finalWords: string[] = [];

  for (const tk of tokens) {
    if (tk.quote === 'single' || tk.quote === 'double') {
      // quoted: no field splitting, no globbing
      finalWords.push(tk.text);
      continue;
    }
    // unquoted: perform IFS splitting
    const parts = splitOnIFS(tk.text, ifs);
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

  console.log('[shell] finalWords:', finalWords);
  return finalWords;
}
