declare module 'url/' {
  export interface UrlObject {
    auth?: string | null;
    hash?: string | null;
    host?: string | null;
    hostname?: string | null;
    pathname?: string | null;
    port?: string | number | null;
    protocol?: string | null;
    query?: string | Record<string, string | string[]> | null;
    search?: string | null;
    slashes?: boolean | null;
  }

  export class Url {
    auth: string | null;
    hash: string | null;
    host: string | null;
    hostname: string | null;
    href: string;
    path: string | null;
    pathname: string | null;
    port: string | null;
    protocol: string | null;
    query: string | null | Record<string, string | string[]>;
    search: string | null;
    slashes: boolean | null;
    constructor();
    parse(input: string, parseQueryString?: boolean, slashesDenoteHost?: boolean): this;
    format(): string;
    resolve(relative: string): string;
    resolveObject(relative: string | Url): Url;
  }

  export interface UrlWithParsedQuery extends Url {
    query: Record<string, string | string[]>;
  }

  export interface UrlWithStringQuery extends Url {
    query: string | null;
  }

  export function parse(input: Url, parseQueryString?: boolean, slashesDenoteHost?: boolean): Url;
  export function parse(
    input: string,
    parseQueryString: true,
    slashesDenoteHost?: boolean
  ): UrlWithParsedQuery;
  export function parse(
    input: string,
    parseQueryString?: false,
    slashesDenoteHost?: boolean
  ): UrlWithStringQuery;
  export function parse(input: string, parseQueryString: boolean, slashesDenoteHost?: boolean): Url;
  export function parse(
    input: string | Url,
    parseQueryString: boolean,
    slashesDenoteHost?: boolean
  ): Url;
  export function format(input: string | UrlObject | Url): string;
  export function resolve(from: string, to: string): string;
  export function resolveObject(from: string | Url, to: string | Url): Url;
}
