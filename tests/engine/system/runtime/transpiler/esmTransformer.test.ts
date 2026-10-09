import { describe, expect, it } from 'vitest';
import { ModuleCode } from '@/engine/system/runtime/module/moduleCode';
import {
  extractCjsDependencies,
  getEsbuildWasmURL,
  runtimeDefines,
  transformEsmToCjs,
} from '@/engine/system/runtime/transpiler/esmTransformer';

describe('esmTransformer', () => {
  it('builds the esbuild wasm URL without a base path', () => {
    const originalBasePath = (globalThis as any).__PYXIS_BASE_PATH__;
    delete (globalThis as any).__PYXIS_BASE_PATH__;

    try {
      expect(getEsbuildWasmURL()).toBe('/esbuild.wasm');
    } finally {
      if (originalBasePath === undefined) {
        delete (globalThis as any).__PYXIS_BASE_PATH__;
      } else {
        (globalThis as any).__PYXIS_BASE_PATH__ = originalBasePath;
      }
    }
  });

  it('builds the esbuild wasm URL with a runtime base path', () => {
    const originalBasePath = (globalThis as any).__PYXIS_BASE_PATH__;
    (globalThis as any).__PYXIS_BASE_PATH__ = '/Pyxis-CodeCanvas/';

    try {
      expect(getEsbuildWasmURL()).toBe('/Pyxis-CodeCanvas/esbuild.wasm');
    } finally {
      if (originalBasePath === undefined) {
        delete (globalThis as any).__PYXIS_BASE_PATH__;
      } else {
        (globalThis as any).__PYXIS_BASE_PATH__ = originalBasePath;
      }
    }
  });

  it('converts ESM imports and exports to CommonJS', async () => {
    const code = await transformEsmToCjs(
      "import fs from 'fs'; export const value = fs.readFileSync; export default value;",
      '/test.js'
    );

    expect(code).toContain('__pyxisRequireImport("fs")');
    expect(code).toContain('value: () => value');
    expect(code).toContain('module.exports = __toCommonJS');
  });

  it('transforms TypeScript with the registered loader', async () => {
    const code = await transformEsmToCjs('const value: number = 3; export { value };', '/test.ts', {
      isTypeScript: true,
    });
    expect(code).not.toContain(': number');
    expect(code).toContain('value');
  });

  it('transforms TypeScript JSX with the TSX loader', async () => {
    const code = await transformEsmToCjs(
      'const value: number = 3; const element = <span>{value}</span>; export { element };',
      '/test.tsx',
      { isTypeScript: true, isJSX: true }
    );
    expect(code).not.toContain(': number');
    expect(code).toContain('React.createElement');
  });

  it('rejects invalid source instead of returning empty code', async () => {
    await expect(transformEsmToCjs('const = ;', '/invalid.js')).rejects.toThrow();
  });

  it('normalizes import.meta.url for the runtime wrapper', async () => {
    const code = await transformEsmToCjs('console.log(import.meta.url);', '/test.mjs');
    expect(code).toContain('"file:///test.mjs"');
  });

  it('encodes file URLs without interpreting path characters as URL syntax', () => {
    const filePath = '/space dir/a%20#?\\.mjs';
    expect(runtimeDefines(filePath)).toMatchObject({
      'import.meta.url': '"file:///space%20dir/a%2520%23%3F%5C.mjs"',
      'import.meta.filename': JSON.stringify(filePath),
      'import.meta.dirname': '"/space dir"',
    });
  });

  it('routes import.meta.resolve through the import resolver', async () => {
    const code = await transformEsmToCjs(
      'export const url = import.meta.resolve("dual");',
      '/test.mjs'
    );
    expect(code).toContain('__pyxisImportMetaResolve("dual")');
  });

  it('preserves top-level async expressions while lowering module exports', async () => {
    const code = await transformEsmToCjs(
      'export const value = await (await Promise.resolve(1)); for await (const item of source) console.log(item);',
      '/async.mjs'
    );
    expect(code).toContain('await');
    expect(code).toContain('for await');
    expect(code).toContain('module.exports =');
    expect(code).not.toContain('__pyxisAwait');
    expect(code).not.toContain('__pyxisAsyncIterable');
  });

  it('preserves await precedence when the resolved value is used by another expression', async () => {
    const code = await transformEsmToCjs(
      `
      export const method = (await Promise.resolve(42)).toString();
      export const property = (await Promise.resolve({ value: 7 })).value;
      export const indexed = (await Promise.resolve(['item']))[0];
      export const called = (await Promise.resolve(() => 'called'))();
      export const optional = (await Promise.resolve({ value: 9 }))?.value;
      export const nested = (await (await Promise.resolve({ value: 11 }))).value;
      `,
      '/precedence.mjs'
    );
    const module = { exports: {} };
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    await new AsyncFunction('module', code)(module);

    expect(module.exports).toMatchObject({
      method: '42',
      property: 7,
      indexed: 'item',
      called: 'called',
      optional: 9,
      nested: 11,
    });
    expect(ModuleCode.analyze(code).hasTopLevelAwait).toBe(true);
    expect(code).not.toContain('__pyxisAwait');
  });

  it('keeps a multiline promise callback identifiable as top-level await after lowering', async () => {
    const code = await transformEsmToCjs(
      `
      import source from 'source';
      const value = await new Promise((resolve, reject) => {
        const request = source.get('entry', incoming => {
          let body = '';
          incoming.on('data', chunk => { body += chunk; });
          incoming.on('end', () => resolve({ body }));
        });
        request.on('error', reject);
      });
      console.log(value);
      `,
      '/callback.mjs'
    );
    expect(ModuleCode.analyze(code).hasTopLevelAwait).toBe(true);
  });

  it('leaves await expressions inside object methods in their function scope', async () => {
    const code = await transformEsmToCjs(
      'export const cli = { async execute() { await run(); for await (const item of source) {} } };',
      '/cli.mjs'
    );
    expect(code).toContain('await run()');
    expect(code).toContain('for await');
    expect(code).not.toContain('__pyxisAwait');
    expect(code).not.toContain('__pyxisAsyncIterable');
  });

  it('preserves top-level await in computed object method keys', async () => {
    const code = await transformEsmToCjs(
      'export const cli = { async [await key()]() { await run(); } };',
      '/cli.mjs'
    );
    expect(code).toMatch(/await\s*\(?\s*key\(\)\s*\)?/);
    expect(code).toContain('await run()');
    expect(code).not.toContain('__pyxisAwait');
  });

  it('preserves top-level await in computed class method keys', async () => {
    const code = await transformEsmToCjs(
      'export class Cli { async [await key()]() { await run(); } }',
      '/cli.mjs'
    );
    expect(code).toMatch(/await\s*\(?\s*key\(\)\s*\)?/);
    expect(code).toContain('await run()');
    expect(code).not.toContain('__pyxisAwait');
  });

  it('preserves local process bindings in the source', async () => {
    const code = await transformEsmToCjs("const process = require('process');", '/test.js');
    expect(code).toContain('const process = __pyxisRequireCommonJs("process")');
  });

  it('extracts require dependencies from transformed code', async () => {
    const code = await transformEsmToCjs(
      "import fs from 'fs'; import { join } from 'path'; export default join;",
      '/dep.js'
    );
    expect(extractCjsDependencies(code)).toEqual(
      expect.arrayContaining([
        { specifier: 'fs', kind: 'import' },
        { specifier: 'path', kind: 'import' },
      ])
    );
  });

  it('routes dynamic imports through the runtime loader', async () => {
    const code = await transformEsmToCjs("const mod = import('lodash');", '/dynamic.js');
    expect(code).toContain('__pyxisImport("lodash")');
  });

  it('preserves distinct import and require conditions and shadowed require calls', async () => {
    const code = await transformEsmToCjs(
      'import value from "dual"; const other = require("dual"); function call(require) { return require("local"); } export { value, other, call };',
      '/dual.mjs'
    );
    expect(extractCjsDependencies(code)).toEqual([
      { specifier: 'dual', kind: 'import' },
      { specifier: 'dual', kind: 'require' },
    ]);
    expect(code).toContain('return require2("local")');
  });
});
