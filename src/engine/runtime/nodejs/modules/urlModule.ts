/** Node.js URL utilities for the browser runtime. */

import type {
  Url as PortUrl,
  UrlWithParsedQuery as PortUrlWithParsedQuery,
  UrlWithStringQuery as PortUrlWithStringQuery,
} from 'url/';
import * as browserUrl from 'url/';
import { posixPath } from '@/engine/core/pathUtils';
import * as querystringModule from './querystringModule';

const RuntimeURL = globalThis.URL;
const RuntimeURLSearchParams = globalThis.URLSearchParams;

export const URL = RuntimeURL;
export const URLSearchParams = RuntimeURLSearchParams;

type FileUrlErrorCode =
  | 'ERR_INVALID_URL_SCHEME'
  | 'ERR_INVALID_FILE_URL_HOST'
  | 'ERR_INVALID_FILE_URL_PATH';

class FileUrlError extends TypeError {
  readonly code: FileUrlErrorCode;

  constructor(code: FileUrlErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

/** Convert a file: URL to a POSIX path. */
export function fileURLToPath(input: string | URL): string {
  const parsedUrl = new URL(input.toString());
  if (parsedUrl.protocol !== 'file:') {
    throw new FileUrlError('ERR_INVALID_URL_SCHEME', 'The URL must be of scheme file');
  }
  if (parsedUrl.hostname && parsedUrl.hostname !== 'localhost') {
    throw new FileUrlError(
      'ERR_INVALID_FILE_URL_HOST',
      `File URL host must be "localhost" or empty on this platform: ${parsedUrl.hostname}`
    );
  }
  if (/%2f/i.test(parsedUrl.pathname)) {
    throw new FileUrlError(
      'ERR_INVALID_FILE_URL_PATH',
      'File URL path must not include encoded / characters'
    );
  }
  return decodeURIComponent(parsedUrl.pathname);
}

/** Parse legacy URL syntax and use Node's querystring representation. */
export function parse(
  input: PortUrl,
  parseQueryString?: boolean,
  slashesDenoteHost?: boolean
): PortUrl;
export function parse(
  input: string,
  parseQueryString: true,
  slashesDenoteHost?: boolean
): PortUrlWithParsedQuery;
export function parse(
  input: string,
  parseQueryString?: false,
  slashesDenoteHost?: boolean
): PortUrlWithStringQuery;
export function parse(
  input: string,
  parseQueryString: boolean,
  slashesDenoteHost?: boolean
): PortUrl;
export function parse(
  input: string | PortUrl,
  parseQueryString: boolean,
  slashesDenoteHost?: boolean
): PortUrl;
export function parse(
  input: string | PortUrl,
  parseQueryString = false,
  slashesDenoteHost = false
): PortUrl {
  if (input instanceof browserUrl.Url) {
    return browserUrl.parse(input, parseQueryString, slashesDenoteHost);
  }

  const parsed = browserUrl.parse(input, parseQueryString, slashesDenoteHost);
  if (parsed.auth !== null && parsed.slashes === true) {
    const authorityStart = parsed.href.indexOf('//') + 2;
    const authEnd = parsed.href.indexOf('@', authorityStart);
    if (authEnd >= authorityStart) {
      const encodedAuth = encodeURIComponent(parsed.auth).replace(/%3A/gi, ':');
      parsed.href = `${parsed.href.slice(0, authorityStart)}${encodedAuth}@${parsed.href.slice(authEnd + 1)}`;
    }
  }
  if (parseQueryString) {
    let query = '';
    if (parsed.search !== null) query = parsed.search.slice(1);
    parsed.query = querystringModule.parse(query);
  }
  return parsed;
}

function toFileURL(path: string, getCwd: () => string): URL {
  let absolutePath: string;
  if (path.startsWith('/')) {
    absolutePath = posixPath.resolve(path);
  } else {
    absolutePath = posixPath.resolve(getCwd(), path);
  }
  if (path.endsWith('/') && !absolutePath.endsWith('/')) absolutePath += '/';
  const encodedPath = absolutePath.split('/').map(encodeURIComponent).join('/');
  return new URL(`file://${encodedPath}`);
}

/** Convert a POSIX path to a file: URL. */
export function pathToFileURL(path: string): URL {
  return toFileURL(path, () => '/');
}

/** Create the URL built-in module for one runtime. */
export function createUrlModule(getCwd: () => string): typeof browserUrl & {
  URL: typeof RuntimeURL;
  URLSearchParams: typeof RuntimeURLSearchParams;
  fileURLToPath: typeof fileURLToPath;
  pathToFileURL: (path: string) => URL;
} {
  return {
    ...browserUrl,
    URL: RuntimeURL,
    URLSearchParams: RuntimeURLSearchParams,
    parse,
    fileURLToPath,
    pathToFileURL: (path: string) => toFileURL(path, getCwd),
  };
}

export default {
  ...browserUrl,
  URL: RuntimeURL,
  URLSearchParams: RuntimeURLSearchParams,
  parse,
  fileURLToPath,
  pathToFileURL,
  createUrlModule,
};
