import {
  basename,
  getParentPath,
  HOME_DIR,
  normalizePath,
  posixPath,
  resolvePath,
} from '@/engine/core/fs/index';

function expandFolderInput(input: string, basePath: string): string {
  const path = input.trim();
  if (path === '~') return HOME_DIR;
  if (path.startsWith('~/')) return normalizePath(`${HOME_DIR}/${path.slice(2)}`);
  if (path.startsWith('~')) throw new Error('Use ~ or ~/ to start a home path.');
  if (posixPath.isAbsolute(path)) return normalizePath(path);
  return resolvePath(basePath, path);
}

export function resolveFolderInput(input: string, basePath = HOME_DIR): string {
  return expandFolderInput(input, basePath);
}

export function folderSearchLocation(
  input: string,
  basePath: string
): { directory: string; prefix: string } {
  const value = input.trim();
  const expandedPath = expandFolderInput(value, basePath);
  if (!value || value === '~' || value.endsWith('/')) {
    return { directory: expandedPath, prefix: '' };
  }
  return { directory: getParentPath(expandedPath), prefix: basename(expandedPath) };
}

export function displayRecentFolderPath(path: string): string {
  const normalizedPath = normalizePath(path);
  if (normalizedPath === HOME_DIR) return '~';
  if (normalizedPath.startsWith(`${HOME_DIR}/`)) {
    return `~${normalizedPath.slice(HOME_DIR.length)}`;
  }
  return normalizedPath;
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
