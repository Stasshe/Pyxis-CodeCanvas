import { describe, expect, it } from 'vitest';
import {
  createUrlModule,
  fileURLToPath,
  parse,
  pathToFileURL,
} from '@/engine/runtime/nodejs/modules/urlModule';

describe('POSIX file URL conversion', () => {
  it('round-trips reserved characters and literal backslashes in a filename', () => {
    const path = '/work/a?b#c%d\\e:f';
    const url = pathToFileURL(path);

    expect(url.search).toBe('');
    expect(url.hash).toBe('');
    expect(fileURLToPath(url)).toBe(path);
  });

  it('rejects file URLs with a remote host', () => {
    try {
      fileURLToPath('file://example.com/work/file');
      throw new Error('Expected a remote file host to be rejected');
    } catch (error) {
      expect(error).toBeInstanceOf(TypeError);
      expect(error).toMatchObject({ code: 'ERR_INVALID_FILE_URL_HOST' });
    }
  });

  it('rejects encoded path separators', () => {
    try {
      fileURLToPath('file:///work/a%2Fb');
      throw new Error('Expected an encoded path separator to be rejected');
    } catch (error) {
      expect(error).toMatchObject({ code: 'ERR_INVALID_FILE_URL_PATH' });
      expect(error).toHaveProperty(
        'message',
        'File URL path must not include encoded / characters'
      );
    }
  });

  it('resolves relative paths against the supplied runtime cwd', () => {
    const urlModule = createUrlModule(() => '/workspace/project');

    expect(urlModule.pathToFileURL('src/index.ts').href).toBe(
      'file:///workspace/project/src/index.ts'
    );
  });

  it('preserves a trailing separator when converting a directory path', () => {
    const urlModule = createUrlModule(() => '/workspace');

    expect(urlModule.pathToFileURL('project/').href).toBe('file:///workspace/project/');
  });
});

describe('legacy URL parsing', () => {
  it('exports the platform URL constructors', () => {
    const urlModule = createUrlModule(() => '/workspace');

    expect(urlModule.URL).toBe(globalThis.URL);
    expect(urlModule.URLSearchParams).toBe(globalThis.URLSearchParams);
    expect(new urlModule.URL('https://example.test/?tag=a').searchParams.get('tag')).toBe('a');
  });

  it('parses request targets without requiring an absolute URL', () => {
    expect(parse('/users?active=true#top')).toEqual({
      protocol: null,
      slashes: null,
      auth: null,
      host: null,
      port: null,
      hostname: null,
      hash: '#top',
      search: '?active=true',
      query: 'active=true',
      pathname: '/users',
      path: '/users?active=true',
      href: '/users?active=true#top',
    });
  });

  it('parses absolute URLs and exposes authority and authentication fields', () => {
    const parsed = parse('https://user:pass@example.test:8443/a%2Fb?q=one&q=two#part');

    expect(parsed).toMatchObject({
      protocol: 'https:',
      slashes: true,
      auth: 'user:pass',
      host: 'example.test:8443',
      port: '8443',
      hostname: 'example.test',
      pathname: '/a%2Fb',
      search: '?q=one&q=two',
      path: '/a%2Fb?q=one&q=two',
      hash: '#part',
    });
  });

  it('preserves an explicit default port and bracketed IPv6 authority', () => {
    const parsed = parse('http://user:pa:ss@[::1]:80/a');

    expect(parsed).toMatchObject({
      auth: 'user:pa:ss',
      host: '[::1]:80',
      hostname: '::1',
      port: '80',
      href: 'http://user:pa:ss@[::1]:80/a',
    });
  });

  it('returns an existing Url instance without rewriting its parsed state', () => {
    const urlModule = createUrlModule(() => '/workspace');
    const existing = new urlModule.Url().parse('http://user:pa%3Ass@example.test/?tag=a', true);
    const originalHref = existing.href;
    const originalQuery = existing.query;

    const parsed = urlModule.parse(existing, true);

    expect(parsed).toBe(existing);
    expect(parsed.href).toBe(originalHref);
    expect(parsed.query).toBe(originalQuery);
  });

  it('can parse repeated query keys when requested', () => {
    const query = parse('/?tag=a&tag=b', true).query;

    expect(query).toEqual({ tag: ['a', 'b'] });
    expect(Object.getPrototypeOf(query)).toBeNull();
  });

  it('keeps asterisk request targets as a pathname', () => {
    expect(parse('*').pathname).toBe('*');
  });

  it('treats protocol-relative input as a request target by default', () => {
    expect(parse('//example.test/path').pathname).toBe('//example.test/path');
    expect(parse('//example.test/path', false, true)).toMatchObject({
      hostname: 'example.test',
      pathname: '/path',
    });
  });

  it('returns an empty query object when query parsing is enabled without a query', () => {
    expect(parse('/users', true).query).toEqual({});
  });
});
