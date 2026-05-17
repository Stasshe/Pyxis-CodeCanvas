const SYNTHETIC_TAB_SUFFIX_RE = /(\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)-\d{10,}-[a-z0-9]{3,}$/i;
const DEFAULT_AUTHORITY = 'model';

function stripSyntheticSuffix(path: string): string {
  return path.replace(/__\d+$/, '').replace(SYNTHETIC_TAB_SUFFIX_RE, '$1');
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

function encodePath(path: string): string {
  return path
    .split('/')
    .map((segment, index) => (index === 0 && segment === '' ? '' : encodeURIComponent(segment)))
    .join('/');
}

export function getMonacoTabAuthority(tabId: string): string {
  return encodeURIComponent(tabId || DEFAULT_AUTHORITY);
}

export function getTabIdFromMonacoAuthority(authority: string): string | null {
  if (!authority || authority === DEFAULT_AUTHORITY) return null;

  try {
    return decodeURIComponent(authority);
  } catch (e) {
    return authority;
  }
}

export function getMonacoModelPath(
  tabId: string,
  fileName: string,
  filePath?: string | null
): string {
  const safeFileName = fileName && fileName.length > 0 ? fileName : `untitled-${tabId}`;
  const rawPath =
    filePath && filePath.length > 0
      ? ensureLeadingSlash(filePath.split(/[?#]/)[0])
      : tabId && tabId.length > 0
        ? ensureLeadingSlash(tabId.split(/[?#]/)[0])
        : `/${safeFileName}`;

  return stripSyntheticSuffix(rawPath);
}

export function getMonacoLanguageFileName(
  tabId: string,
  fileName: string,
  filePath?: string | null
): string {
  const modelPath = getMonacoModelPath(tabId, fileName, filePath);
  return modelPath.split('/').pop() || fileName;
}

export function getMonacoModelUriValue(
  tabId: string,
  fileName: string,
  filePath?: string | null
): string {
  const modelPath = getMonacoModelPath(tabId, fileName, filePath);
  return `inmemory://${getMonacoTabAuthority(tabId)}${encodePath(modelPath)}`;
}

export function getPathFromMonacoResourcePath(resourcePath: string): string {
  const normalized = stripSyntheticSuffix(resourcePath || '');
  return normalized.startsWith('/') ? normalized.substring(1) : normalized;
}
