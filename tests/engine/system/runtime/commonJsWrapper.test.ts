import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../../_helpers/nodeRuntime';

describe('CommonJS wrapper bindings', () => {
  let fixture: NodeRuntimeFixture;
  let output: string[];

  beforeEach(async () => {
    output = [];
    fixture = await createNodeRuntimeFixture('/tmp/commonjs-wrapper', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: () => {},
      warn: () => {},
      clear: () => {},
    });
  });

  afterEach(() => fixture.close());

  function nativeExports(source: string, path: string): object {
    const module = { exports: {} };
    const body = new Function('exports', 'require', 'module', '__filename', '__dirname', source);
    body.call(
      module.exports,
      module.exports,
      createRequire(import.meta.url),
      module,
      path,
      fixture.rootPath
    );
    return module.exports;
  }

  async function run(source: string): Promise<void> {
    const path = `${fixture.rootPath}/entry.cjs`;
    await fixture.writeFile(path, source);
    await fixture.runtime.execute(path);
    await fixture.runtime.waitForEventLoop();
  }

  it('preserves initial parameters before var redeclarations and ignores local module reassignment', async () => {
    const source = `
      exports.initial = module.exports === exports;
      exports.context = this === exports;
      var module = { exports: { wrong: true } };
      var exports;
      var require;
      var __filename;
      var __dirname;
      exports.value = 7;
      exports.filename = require('node:path').basename(__filename);
      exports.dirname = __dirname;
    `;
    const path = `${fixture.rootPath}/parameters.cjs`;
    await fixture.writeFile(path, source);
    await run("console.log(JSON.stringify(require('./parameters.cjs')));");
    expect(output).toEqual([JSON.stringify(nativeExports(source, path))]);
  });

  it('ignores an explicit CommonJS return value while preserving replaced exports', async () => {
    const source = 'module.exports = { value: 7 }; return { value: 99 };';
    const path = `${fixture.rootPath}/returned.cjs`;
    await fixture.writeFile(path, source);
    await run("console.log(JSON.stringify(require('./returned.cjs')));");
    expect(output).toEqual([JSON.stringify(nativeExports(source, path))]);
  });

  it('keeps the initial exports alias when the source reassigns exports', async () => {
    const source = 'exports.value = 7; exports = { value: 99 };';
    const path = `${fixture.rootPath}/alias.cjs`;
    await fixture.writeFile(path, source);
    await run("console.log(JSON.stringify(require('./alias.cjs')));");
    expect(output).toEqual([JSON.stringify(nativeExports(source, path))]);
  });

  it('uses original entry exports for its promise after local module reassignment and return', async () => {
    await run(`
      exports.initial = module.exports === exports;
      var module = { exports: { wrong: true } };
      exports.__promise = new Promise(resolve => {
        setTimeout(() => { console.log('entry', exports.initial); resolve(); }, 0);
      });
      return new Promise(() => {});
    `);
    expect(output).toEqual(['entry true']);
  });
});
