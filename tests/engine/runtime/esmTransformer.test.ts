import { describe, expect, it } from 'vitest';
import {
  extractCjsDependencies,
  transformEsmToCjs,
} from '@/engine/runtime/transpiler/esmTransformer';

describe('esmTransformer', () => {
  it('ESM import/export を CommonJS に変換する', async () => {
    const code = await transformEsmToCjs(
      "import fs from 'fs'; export const value = fs.readFileSync; export default value;",
      '/test.js'
    );

    expect(code).toContain("require(\"fs\")");
    expect(code).toContain('value: () => value');
    expect(code).toContain('module.exports = __toCommonJS');
  });

  it('import.meta.url を runtime wrapper 向けに補正する', async () => {
    const code = await transformEsmToCjs('console.log(import.meta.url);', '/test.mjs');
    expect(code).toContain('var import_meta = { url: "file:///" + __filename };');
  });

  it('process の再宣言を除去する', async () => {
    const code = await transformEsmToCjs("const process = require('process');", '/test.js');
    expect(code).not.toContain("const process = require('process');");
  });

  it('変換後CJSから require 依存を抽出する', async () => {
    const code = await transformEsmToCjs(
      "import fs from 'fs'; import { join } from 'path'; export default join;",
      '/dep.js'
    );
    expect(extractCjsDependencies(code)).toEqual(expect.arrayContaining(['fs', 'path']));
  });

  it('dynamic import を require ベースに変換する', async () => {
    const code = await transformEsmToCjs("const mod = import('lodash');", '/dynamic.js');
    expect(code).toContain('Promise.resolve(require("lodash"))');
  });
});
