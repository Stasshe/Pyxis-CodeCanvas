const WORKSPACE_AUTHORITY = 'workspace';

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment, index) => (index === 0 && segment === '' ? '' : encodeURIComponent(segment)))
    .join('/');
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Monaco model cache key.
 * File-based tabs: filePath (shared across tabs showing same file).
 * Untitled tabs: tabId (unique per tab).
 */
export function getModelCacheKey(filePath: string | undefined | null, tabId: string): string {
  return filePath && filePath.length > 0 ? filePath : tabId;
}

/**
 * Monaco model URI.
 * Fixed 'workspace' authority enables TypeScript worker cross-file resolution.
 * URI path ends with real file extension so TS worker derives correct ScriptKind.
 */
export function getWorkspaceModelUri(filePath: string | undefined | null, tabId: string): string {
  if (filePath && filePath.length > 0) {
    const normalized = ensureLeadingSlash(filePath.split(/[?#]/)[0]);
    return `inmemory://${WORKSPACE_AUTHORITY}${encodePath(normalized)}`;
  }
  return `inmemory://${WORKSPACE_AUTHORITY}/untitled/${encodeURIComponent(tabId)}`;
}

/**
 * Filename used for language detection (basename of filePath, fallback to fileName).
 */
export function getLanguageFileName(filePath: string | undefined | null, fileName: string): string {
  if (filePath && filePath.length > 0) {
    const basename = filePath.split('/').pop();
    if (basename && basename.length > 0) return basename;
  }
  return fileName;
}

/**
 * Display path from Monaco URI resource path — strips leading slash.
 */
export function getFilePathFromUri(resourcePath: string): string {
  const path = resourcePath || '';
  return path.startsWith('/') ? path.substring(1) : path;
}
