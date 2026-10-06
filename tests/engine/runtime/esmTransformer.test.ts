import { describe, expect, it } from 'vitest';
import {
  extractCjsDependencies,
  getEsbuildWasmURL,
  transformEsmToCjs,
} from '@/engine/runtime/transpiler/esmTransformer';

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

    expect(code).toContain('require("fs")');
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
    expect(code).toContain('var import_meta = { url: "file:///" + __filename };');
  });

  it('removes a local process redeclaration', async () => {
    const code = await transformEsmToCjs("const process = require('process');", '/test.js');
    expect(code).not.toContain("const process = require('process');");
  });

  it('extracts require dependencies from transformed code', async () => {
    const code = await transformEsmToCjs(
      "import fs from 'fs'; import { join } from 'path'; export default join;",
      '/dep.js'
    );
    expect(extractCjsDependencies(code)).toEqual(expect.arrayContaining(['fs', 'path']));
  });

  it('routes dynamic imports through the runtime loader', async () => {
    const code = await transformEsmToCjs("const mod = import('lodash');", '/dynamic.js');
    expect(code).toContain('__pyxisImport("lodash")');
  });
});
