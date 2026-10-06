import { HOME_DIR, normalizePath, posixPath, resolvePath } from '@/engine/core/fs';

export function resolveFolderInput(input: string): string {
  const path = input.trim();
  if (path === '~') return HOME_DIR;
  if (path.startsWith('~/')) return normalizePath(`${HOME_DIR}/${path.slice(2)}`);
  if (!posixPath.isAbsolute(path)) throw new Error('Enter an absolute path or a path under ~.');
  return normalizePath(path);
}

export function workspaceDestination(name: string): string {
  const cleanedName = name.trim();
  if (
    !cleanedName ||
    cleanedName === '.' ||
    cleanedName === '..' ||
    cleanedName.includes('/') ||
    cleanedName.includes('\0')
  ) {
    return `${HOME_DIR}/<name>`;
  }
  return resolvePath(HOME_DIR, cleanedName);
}

export function isWorkspaceNameValid(name: string): boolean {
  const cleanedName = name.trim();
  return Boolean(
    cleanedName &&
      cleanedName !== '.' &&
      cleanedName !== '..' &&
      !cleanedName.includes('/') &&
      !cleanedName.includes('\0')
  );
}
