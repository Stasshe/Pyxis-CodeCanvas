import { transformSync } from '@swc/wasm';

// テスト用: transpileWorker.ts からAST変換プラグインをimport
import { swcAsyncModulePlugin } from '../src/engine/runtime/transpileWorker';

describe('swcAsyncModulePlugin AST変換', () => {
  function run(code: string, opts: any = {}) {
    const result = transformSync(code, {
      filename: 'test.js',
      jsc: {
        parser: { syntax: 'ecmascript' },
      },
      experimental: {
        plugins: [[swcAsyncModulePlugin]],
      },
      ...opts,
    });
    return result.code.trim();
  }

  it('import default', () => {
    expect(run("import foo from 'bar';")).toContain('await __require__(\'bar\')');
  });

  it('import named', () => {
    expect(run("import {foo} from 'bar';")).toContain('await __require__(\'bar\')');
  });

  it('import namespace', () => {
    expect(run("import * as ns from 'bar';")).toContain('await __require__(\'bar\')');
  });

  it('import side effect', () => {
    expect(run("import 'bar';")).toContain('await __require__(\'bar\')');
  });

  it('export default', () => {
    expect(run("export default 1;")).toContain('module.exports.default = 1');
  });

  it('export named', () => {
    expect(run("export const foo = 1;")).toContain('module.exports.foo = foo');
  });

  it('require', () => {
    expect(run("const x = require('bar');")).toContain('await __require__(\'bar\')');
  });

  it('dynamic import', () => {
    expect(run("const x = import('bar');")).toContain('await __import__(\'bar\')');
  });
});
