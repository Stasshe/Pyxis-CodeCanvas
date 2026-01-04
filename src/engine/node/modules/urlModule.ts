/**
 * Node.js built-in `url` module stub
 * Provides minimal URL utilities needed by Prettier
 */

/**
 * Convert file: URL to path
 */
export function fileURLToPath(url: string | URL): string {
  const urlStr = typeof url === 'string' ? url : url.toString();

  // Remove file:// protocol
  if (urlStr.startsWith('file://')) {
    let path = urlStr.slice(7); // Remove 'file://'

    // Handle Windows paths (file:///C:/...)
    if (path.startsWith('/') && /^\/[a-zA-Z]:/.test(path)) {
      path = path.slice(1); // Remove leading /
    }

    // Decode URL encoding
    path = decodeURIComponent(path);

    return path;
  }

  return urlStr;
}

/**
 * Convert path to file: URL
 */
export function pathToFileURL(path: string): URL {
  let urlPath = path.replace(/\\/g, '/'); // Normalize backslashes

  // Add leading slash if needed for absolute paths on Windows
  if (/^[a-zA-Z]:/.test(urlPath)) {
    urlPath = `/${urlPath}`;
  }

  return new URL(`file://${encodeURI(urlPath)}`);
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
