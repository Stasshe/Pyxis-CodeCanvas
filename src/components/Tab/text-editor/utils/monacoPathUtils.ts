const SYNTHETIC_TAB_SUFFIX_RE = /(\.[A-Za-z0-9]+(?:\.[A-Za-z0-9]+)?)-\d{10,}-[a-z0-9]{3,}$/i;

function stripSyntheticSuffix(path: string): string {
  return path.replace(/__\d+$/, '').replace(SYNTHETIC_TAB_SUFFIX_RE, '$1');
}

function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

export function getMonacoModelPath(tabId: string, fileName: string): string {
  const safeFileName = fileName && fileName.length > 0 ? fileName : `untitled-${tabId}`;
  const rawPath =
    tabId && tabId.length > 0 ? ensureLeadingSlash(tabId.split(/[?#]/)[0]) : `/${safeFileName}`;

  return stripSyntheticSuffix(rawPath);
}

export function getMonacoModelUriValue(tabId: string, fileName: string): string {
  const modelPath = getMonacoModelPath(tabId, fileName);
  const query = tabId && tabId !== modelPath ? `?tabId=${encodeURIComponent(tabId)}` : '';
  return `inmemory://model${modelPath}${query}`;
}

export function getPathFromMonacoResourcePath(resourcePath: string): string {
  const normalized = stripSyntheticSuffix(resourcePath || '');
  return normalized.startsWith('/') ? normalized.substring(1) : normalized;
}

export function getTabIdFromMonacoResourceQuery(resourceQuery: string): string | null {
  if (!resourceQuery) return null;

  try {
    return new URLSearchParams(resourceQuery).get('tabId');
  } catch (e) {
    return null;
  }
}
