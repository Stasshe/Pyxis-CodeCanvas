/**
 * Node.js built-in `url` module stub
 * Provides minimal URL utilities needed by Prettier
 */

import { normalizePath } from '@/engine/core/pathUtils';

/**
 * Convert file: URL to path
 */
export function fileURLToPath(url: string | URL): string {
  const urlStr = typeof url === 'string' ? url : url.toString();
  const parsedUrl = new URL(urlStr);
  if (parsedUrl.protocol !== 'file:') return urlStr;
  if (parsedUrl.hostname && parsedUrl.hostname !== 'localhost') {
    throw new TypeError(`File URL host must be empty or localhost: ${parsedUrl.hostname}`);
  }
  return normalizePath(decodeURIComponent(parsedUrl.pathname));
}

/**
 * Convert path to file: URL
 */
export function pathToFileURL(path: string): URL {
  const absolutePath = normalizePath(path);
  const encodedPath = absolutePath.split('/').map(encodeURIComponent).join('/');
  return new URL(`file://${encodedPath}`);
}

/**
 * Legacy URL parsing (for compatibility)
 */
export function parse(urlString: string): any {
  try {
    const url = new URL(urlString);
    return {
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      href: url.href,
    };
  } catch {
    return null;
  }
}

// Default export for CommonJS compatibility
export default {
  fileURLToPath,
  pathToFileURL,
  parse,
};
