import { describe, expect, it } from 'vitest';
import * as querystring from '@/engine/runtime/nodejs/modules/querystringModule';

describe('Node querystring builtin', () => {
  it('collects repeated keys into arrays', () => {
    expect(querystring.parse('tag=one&tag=two&empty')).toEqual({
      tag: ['one', 'two'],
      empty: '',
    });
  });

  it('uses custom separators and assignment strings', () => {
    expect(querystring.parse('name:Stasshe;role:owner', ';', ':')).toEqual({
      name: 'Stasshe',
      role: 'owner',
    });
    expect(querystring.stringify({ name: 'Stasshe', role: 'owner' }, ';', ':')).toBe(
      'name:Stasshe;role:owner'
    );
  });

  it('decodes plus as space and limits parsed keys', () => {
    expect(
      querystring.parse('q=hello+world&later=yes', undefined, undefined, { maxKeys: 1 })
    ).toEqual({
      q: 'hello world',
    });
  });

  it('counts empty pairs without creating empty keys and splits before decoding plus', () => {
    expect(querystring.parse('&&a=one&b=two', '&', '=', { maxKeys: 3 })).toMatchObject({
      a: 'one',
    });
    expect(querystring.parse('a+b+c', '&', '+')).toMatchObject({ a: 'b c' });
    expect(
      querystring.parse('q=a+b', '&', '=', { decodeURIComponent: value => value })
    ).toMatchObject({ q: 'a%20b' });
  });

  it('keeps encode and decode as aliases', () => {
    expect(querystring.decode).toBe(querystring.parse);
    expect(querystring.encode).toBe(querystring.stringify);
  });

  it('matches Node escaping and serializes values with its querystring rules', () => {
    expect(querystring.stringify({ text: 'hello world', flags: ['a', 'b'], empty: null })).toBe(
      'text=hello%20world&flags=a&flags=b&empty='
    );
    expect(querystring.escape("!'()* /")).toBe("!'()*%20%2F");
    expect(querystring.unescape('a+b')).toBe('a+b');
    expect(querystring.stringify('hello')).toBe('');
  });

  it('decodes malformed percent escapes without throwing', () => {
    expect(querystring.parse('q=%')).toMatchObject({ q: '%' });
    expect(querystring.parse('q=%E0%A4%A')).toMatchObject({ q: '�%A' });
    expect(Object.getPrototypeOf(querystring.parse('__proto__=safe'))).toBe(null);
  });

  it('uses custom decode and encode component callbacks', () => {
    expect(
      querystring.parse('q=value', undefined, undefined, {
        decodeURIComponent: value => `[${value}]`,
      })
    ).toMatchObject({ '[q]': '[value]' });
    expect(
      querystring.stringify({ q: 'value' }, undefined, undefined, {
        encodeURIComponent: value => `[${value}]`,
      })
    ).toBe('[q]=[value]');
  });

  it('falls back when a custom decoder rejects malformed input', () => {
    expect(
      querystring.parse('q=%', undefined, undefined, {
        decodeURIComponent: () => {
          throw new URIError('Invalid query component.');
        },
      })
    ).toMatchObject({ q: '%' });
  });
});
