import { Buffer } from 'buffer';
import { fileURLToPath } from './urlModule';

export type FsPath = string | Buffer | URL;

export function normalizeFsPath(path: FsPath, getCwd: () => string): string {
  let value: string;
  if (typeof path === 'string') value = path;
  else if (Buffer.isBuffer(path)) value = path.toString();
  else value = fileURLToPath(path);

  if (value.startsWith('/')) return value;
  const cwd = getCwd();
  if (cwd === '/') return `/${value}`;
  return `${cwd}/${value}`;
}
