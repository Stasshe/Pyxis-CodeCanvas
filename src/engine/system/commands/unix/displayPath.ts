import { posixPath } from '@/engine/core/fs/index';

export function displayPathForOperand(operand: string, resolvedPath: string, path: string): string {
  const displayRoot = operand === '/' ? '/' : operand.replace(/\/+$/, '') || '.';
  if (path === resolvedPath) return displayRoot;

  const relativePath = posixPath.relative(resolvedPath, path);
  if (displayRoot === '/') return `/${relativePath}`;
  return `${displayRoot}/${relativePath}`;
}
