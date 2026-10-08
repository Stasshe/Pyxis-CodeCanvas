import { describe, expect, it } from 'vitest';
import { ModuleCode } from '@/engine/runtime/module/moduleCode';

describe('ModuleCode', () => {
  it('ignores module keywords and calls inside comments, strings, regexes and property names', () => {
    const source = [
      '// require("comment") and import("comment")',
      'const text = \'require("string")\';',
      'const pattern = /import\\("regex"\\)/;',
      'const object = { import: 1, export: 2 };',
      'const template = `require("template")`;',
    ].join('\n');
    expect(ModuleCode.analyze(source)).toMatchObject({
      dependencies: [],
      hasEsmSyntax: false,
      hasDynamicImport: false,
    });
  });

  it('preserves import and require requests for the same specifier', () => {
    expect(ModuleCode.analyze('import value from "dual"; require("dual");').dependencies).toEqual([
      { specifier: 'dual', kind: 'import' },
      { specifier: 'dual', kind: 'require' },
    ]);
  });

  it('detects imports and calls inside template expressions', () => {
    expect(ModuleCode.analyze('const text = `${require("real")}`; import("other");')).toMatchObject(
      {
        dependencies: [
          { specifier: 'real', kind: 'require' },
          { specifier: 'other', kind: 'import' },
        ],
        hasEsmSyntax: false,
        hasDynamicImport: true,
      }
    );
  });

  it('extracts static template specifiers and leaves interpolated paths dynamic', () => {
    expect(
      ModuleCode.analyze('require(`./static`); import(`module`); require(`./${name}`);')
        .dependencies
    ).toEqual([
      { specifier: './static', kind: 'require' },
      { specifier: 'module', kind: 'import' },
    ]);
  });

  it('distinguishes top-level await from await within a function', () => {
    expect(ModuleCode.analyze('await load();').hasEsmSyntax).toBe(true);
    expect(ModuleCode.analyze('async function load() { await run(); }').hasEsmSyntax).toBe(false);
  });

  it('recognizes lexical redeclarations of CommonJS wrapper names', () => {
    expect(ModuleCode.analyze('class require {}').hasEsmSyntax).toBe(true);
    expect(ModuleCode.analyze('const __filename = "local";').hasEsmSyntax).toBe(true);
    expect(
      ModuleCode.analyze('function local() { const __filename = "local"; }').hasEsmSyntax
    ).toBe(false);
  });

  it('parses TypeScript and JSX dialects without treating type text as dependency calls', () => {
    expect(
      ModuleCode.analyze('const view = <span>{require("actual")}</span>;', '/view.tsx').dependencies
    ).toEqual([{ specifier: 'actual', kind: 'require' }]);
  });

  it('ignores erased TypeScript module declarations when selecting runtime format', () => {
    const source =
      'import type Shape from "types"; export interface Item { value: number } export type Name = string;';
    expect(ModuleCode.analyze(source, '/module.cts')).toMatchObject({
      hasEsmSyntax: false,
      dependencies: [],
    });
    expect(
      ModuleCode.analyze('import { type Shape } from "types";', '/module.cts').hasEsmSyntax
    ).toBe(false);
    expect(
      ModuleCode.analyze('import { type Shape, value } from "mixed";', '/module.cts').hasEsmSyntax
    ).toBe(true);
  });

  it('rewrites actual import expressions and leaves regexes and strings intact', () => {
    expect(ModuleCode.runtimeCode('const text = \'import("fake")\'; import("real");')).toBe(
      'const text = \'import("fake")\'; __pyxisImport("real");'
    );
  });

  it('prioritizes explicit JavaScript and TypeScript formats over package type', () => {
    const analysis = ModuleCode.analyze('console.log(1);');
    expect(ModuleCode.needsTranspile('/file.cjs', analysis, 'module')).toBe(false);
    expect(ModuleCode.needsTranspile('/file.mjs', analysis, 'commonjs')).toBe(true);
    expect(ModuleCode.needsTranspile('/file.cts', analysis, 'module')).toBe(true);
    expect(ModuleCode.needsTranspile('/file.mts', analysis, 'commonjs')).toBe(true);
  });
});
