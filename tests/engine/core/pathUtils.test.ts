import { describe, expect, it } from 'vitest';
import {
  basename,
  getParentPath,
  isPathWithin,
  normalizePath,
  posixPath,
  resolvePath,
} from '@/engine/core/pathUtils';

describe('absolute filesystem paths', () => {
  it('normalizes separators and resolves dot segments without escaping root', () => {
    expect(normalizePath('//app/src/.././file/')).toBe('/app/file');
    expect(normalizePath('/../../file')).toBe('/file');
    expect(normalizePath('/')).toBe('/');
  });

  it('resolves relative paths and resets for absolute paths', () => {
    expect(resolvePath('/app/src', '../test', 'a.ts')).toBe('/app/test/a.ts');
    expect(resolvePath('/app', '/tmp', 'a')).toBe('/tmp/a');
  });

  it('finds parents and basenames at root boundaries', () => {
    expect(getParentPath('/app/a')).toBe('/app');
    expect(getParentPath('/app')).toBe('/');
    expect(getParentPath('/')).toBe('/');
    expect(basename('/app/a/')).toBe('a');
    expect(basename('/')).toBe('');
    expect(basename('foo/..')).toBe('..');
  });

  it('rejects relative and NUL paths at filesystem boundaries', () => {
    expect(() => normalizePath('relative')).toThrow('EINVAL');
    expect(() => normalizePath('/file\0name')).toThrow('EINVAL');
    expect(() => resolvePath('relative', 'child')).toThrow('EINVAL');
  });

  it('preserves POSIX lexical semantics separately from filesystem boundaries', () => {
    expect(posixPath.normalize('a/../b')).toBe('b');
    expect(posixPath.join('/app', '/child')).toBe('/app/child');
    expect(posixPath.resolve('/app', '/child')).toBe('/child');
    expect(posixPath.relative('/app/a', '/app/b')).toBe('../b');
    expect(posixPath.dirname('file')).toBe('.');
    expect(posixPath.extname('file.ts')).toBe('.ts');
    expect(posixPath.format(posixPath.parse('/app/file.ts'))).toBe('/app/file.ts');
  });

  it('checks directory boundaries instead of string prefixes', () => {
    expect(isPathWithin('/app/file', '/app')).toBe(true);
    expect(isPathWithin('/application/file', '/app')).toBe(false);
    expect(isPathWithin('/app/../tmp', '/app')).toBe(false);
    expect(isPathWithin('/tmp', '/')).toBe(true);
  });
});
