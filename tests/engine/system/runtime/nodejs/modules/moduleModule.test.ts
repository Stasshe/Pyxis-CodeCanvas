import { describe, expect, it } from 'vitest';
import { createModuleModule } from '@/engine/system/runtime/nodejs/modules/moduleModule';

function failRequireFactory(): never {
  throw new Error('require factory should not be called for an invalid filename');
}

describe('module.createRequire', () => {
  it('converts file URLs to decoded absolute POSIX paths', () => {
    let resolvedFilename = '';
    const moduleModule = createModuleModule(filename => {
      resolvedFilename = filename;
      return id => id;
    });

    const require = moduleModule.createRequire('file:///workspace/a%20b%23c/package.json');

    expect(resolvedFilename).toBe('/workspace/a b#c/package.json');
    expect(require('./relative')).toBe('./relative');
  });

  it('accepts URL objects and treats trailing directory separators as a module base', () => {
    const filenames: string[] = [];
    const moduleModule = createModuleModule(filename => {
      filenames.push(filename);
      return () => undefined;
    });

    moduleModule.createRequire(new URL('file:///workspace/project/'));
    moduleModule.createRequire('/workspace/project/');

    expect(filenames).toEqual(['/workspace/project/noop.js', '/workspace/project/noop.js']);
  });

  it.each([
    'relative.js',
    'https://example.test/module.js',
    'file:///workspace/%2f/module.js',
    'file:///workspace/%ZZ/module.js',
  ])('rejects invalid createRequire filename %s', filename => {
    expect(() => createModuleModule(failRequireFactory).createRequire(filename)).toThrow(
      expect.objectContaining({ name: 'TypeError', code: 'ERR_INVALID_ARG_VALUE' })
    );
  });

  it('rejects URL objects that are not valid file URLs', () => {
    expect(() =>
      createModuleModule(failRequireFactory).createRequire(
        new URL('https://example.test/module.js')
      )
    ).toThrow(expect.objectContaining({ name: 'TypeError', code: 'ERR_INVALID_ARG_VALUE' }));
  });
});
