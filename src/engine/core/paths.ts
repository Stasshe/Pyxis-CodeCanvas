import path from 'path-browserify';
import { FSError } from './fs/errors';

export const HOME_DIR = '/home/pyxis';

/** Shared lexical POSIX operations. Shell expansion belongs to the shell. */
export const posixPath = path;

/** Filesystem boundaries accept only absolute paths, never cwd-dependent input. */
export function normalizePath(input: string): string {
  if (!path.isAbsolute(input) || input.includes('\0')) throw new FSError('EINVAL', input);
  const normalized = path.normalize(input);
  if (normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
}

export function resolvePath(base: string, ...paths: string[]): string {
  const cwd = normalizePath(base);
  return normalizePath(path.resolve(cwd, ...paths));
}

export function getParentPath(input: string): string {
  return path.dirname(normalizePath(input));
}

export const basename = path.basename;

export function isPathWithin(input: string, root: string): boolean {
  const normalized = normalizePath(input);
  const parent = normalizePath(root);
  return parent === '/' || normalized === parent || normalized.startsWith(`${parent}/`);
}
