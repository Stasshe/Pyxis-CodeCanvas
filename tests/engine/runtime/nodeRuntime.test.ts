import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { isRetiredRuntimePromise } from '@/engine/runtime/nodejs/nodeRuntime';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('NodeRuntime execution', () => {
  let fixture: NodeRuntimeFixture;
  let output: string[];
  let errors: string[];

  beforeEach(async () => {
    output = [];
    errors = [];
    fixture = await createNodeRuntimeFixture('/tmp/runtime-tests', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: (...args) => errors.push(args.map(String).join(' ')),
      warn: (...args) => output.push(args.map(String).join(' ')),
      clear: () => {},
    });
  });

  afterEach(() => {
    fixture.close();
  });

  async function run(name: string, source: string): Promise<void> {
    const path = `${fixture.rootPath}/${name}`;
    await fixture.writeFile(path, source);
    await fixture.runtime.execute(path, []);
    await fixture.runtime.waitForEventLoop();
  }

  it('stops after process.exit and preserves its exit code', async () => {
    await run(
      'exit.js',
      "console.log('before exit');\nprocess.exit(3);\nconsole.log('after exit');"
    );

    expect(fixture.runtime.getExitCode()).toBe(3);
    expect(output.join('\n')).toContain('before exit');
    expect(output.join('\n')).not.toContain('after exit');
    expect(errors).toHaveLength(0);
  });

  it('runs exit listeners once and preserves their output', async () => {
    await run(
      'exit-listener.js',
      "process.once('exit', code => console.log('exit listener', code)); process.exit(3);"
    );

    expect(fixture.runtime.getExitCode()).toBe(3);
    expect(output.join('\n').match(/exit listener 3/g)).toHaveLength(1);
  });

  it('lets process.exit finish while an exported promise remains unresolved', async () => {
    await run(
      'exit-pending-promise.js',
      'module.exports.__promise = new Promise(() => {}); setTimeout(() => process.exit(9), 0);'
    );

    expect(fixture.runtime.getExitCode()).toBe(9);
  });

  it('uses the canonical home path for process and os', async () => {
    const path = `${HOME_DIR}/workspace/home.js`;
    await fixture.writeFile(path, "console.log(process.env.HOME, require('os').homedir());");
    await fixture.runtime.execute(path, []);
    await fixture.runtime.waitForEventLoop();

    expect(output.join('\n')).toContain(`${HOME_DIR} ${HOME_DIR}`);
  });

  it('propagates process.exit from a dynamically required module', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/dep.js`,
      "console.log('dep start');\nprocess.exit(7);\nconsole.log('dep after exit');"
    );
    await run(
      'main.js',
      "const dependency = './dep';\nrequire(dependency);\nconsole.log('main after require');"
    );

    const combined = [...output, ...errors].join('\n');
    expect(fixture.runtime.getExitCode()).toBe(7);
    expect(combined).toContain('dep start');
    expect(combined).not.toContain('dep after exit');
    expect(combined).not.toContain('main after require');
    expect(combined).not.toContain('Module execution failed');
  });

  it('waits for module.exports.__promise before finishing', async () => {
    await run(
      'promise.js',
      [
        'module.exports.__promise = Promise.resolve().then(() => {',
        "  console.log('async version output');",
        '});',
      ].join('\n')
    );

    expect(fixture.runtime.getExitCode()).toBe(0);
    expect(output.join('\n')).toContain('async version output');
    expect(errors).toHaveLength(0);
  });

  it('waits for unreturned asynchronous filesystem work', async () => {
    await run(
      'async-fs.js',
      [
        "const { readdir } = require('fs');",
        "const { promisify } = require('util');",
        'const list = promisify(readdir);',
        '(async () => {',
        `  await list('${fixture.rootPath}');`,
        "  console.log('async fs output');",
        '})();',
      ].join('\n')
    );

    expect(fixture.runtime.getExitCode()).toBe(0);
    expect(output.join('\n')).toContain('async fs output');
    expect(errors).toHaveLength(0);
  });

  it('waits for timers scheduled by a successful filesystem promise handler', async () => {
    await fixture.writeFile(`${fixture.rootPath}/follow-on.txt`, 'ready');
    await run(
      'promise-timer.js',
      [
        "const fs = require('fs');",
        `fs.promises.readFile('${fixture.rootPath}/follow-on.txt').then(() => {`,
        "  setTimeout(() => console.log('follow-on timer completed'), 0);",
        '});',
      ].join('\n')
    );

    expect(output.join('\n')).toContain('follow-on timer completed');
    expect(fixture.runtime.getExitCode()).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('tracks timers accessed through globalThis and global', async () => {
    await run(
      'global-timers.js',
      [
        "const timeout = globalThis.setTimeout(() => console.log('globalThis timeout'), 0);",
        'timeout.unref();',
        'timeout.ref();',
        "const immediate = global.setImmediate(() => console.log('global immediate'));",
        'immediate.unref();',
        'immediate.ref();',
      ].join('\n')
    );

    expect(output.join('\n')).toContain('globalThis timeout');
    expect(output.join('\n')).toContain('global immediate');
    expect(fixture.runtime.getExitCode()).toBe(0);
    expect(errors).toHaveLength(0);
  });

  it('cancels execution timers and drops output callbacks on disposal', async () => {
    const path = `${fixture.rootPath}/disposed.js`;
    await fixture.writeFile(
      path,
      "setTimeout(() => console.log('late timer'), 20); process.on('exit', () => console.log('late listener'));"
    );
    await fixture.runtime.execute(path, []);
    fixture.runtime.dispose();
    await new Promise(resolve => setTimeout(resolve, 30));

    expect(output.join('\n')).not.toContain('late timer');
    expect(output.join('\n')).not.toContain('late listener');
  });

  it('marks only tracked promises retired during disposal', async () => {
    let rejectPending: (error: Error) => void = () => {};
    const pending = new Promise<void>((_resolve, reject) => {
      rejectPending = reject;
    });
    const tracked = fixture.runtime.trackIO(pending);
    fixture.runtime.dispose();
    rejectPending(new Error('Runtime closed.'));

    expect(isRetiredRuntimePromise(tracked)).toBe(true);
    const active = Promise.resolve();
    expect(isRetiredRuntimePromise(active)).toBe(false);
    await tracked.catch(() => {});
  });

  it('preserves caller handling for a rejected tracked filesystem promise', async () => {
    await run(
      'handled-fs-error.js',
      [
        "const fs = require('fs');",
        `fs.promises.readFile('${fixture.rootPath}/missing.txt').catch(error => {`,
        "  console.log('handled fs error', error.code);",
        '});',
      ].join('\n')
    );

    expect(fixture.runtime.getExitCode()).toBe(0);
    expect(output.join('\n')).toContain('handled fs error ENOENT');
    expect(errors).toHaveLength(0);
  });

  it('reads a new file synchronously immediately after writing it', async () => {
    await run(
      'sync-fs.js',
      [
        "const fs = require('fs');",
        `fs.writeFileSync('${fixture.rootPath}/generated.txt', 'fresh');`,
        `console.log(fs.readFileSync('${fixture.rootPath}/generated.txt', 'utf8'));`,
      ].join('\n')
    );

    expect(output.join('\n')).toContain('fresh');
    expect(errors).toHaveLength(0);
  });

  it('resolves a dynamic require that was not found during dependency preloading', async () => {
    await fixture.writeFile(`${fixture.rootPath}/later.js`, "module.exports = 'loaded on demand';");
    await run(
      'dynamic.js',
      [
        "const dependency = './later';",
        'const result = require(dependency);',
        'console.log(result);',
      ].join('\n')
    );

    expect(output.join('\n')).toContain('loaded on demand');
    expect(errors).toHaveLength(0);
  });

  it('reads a plain CommonJS entry once and avoids transpile/cache RPCs', async () => {
    const asyncRequests = vi.spyOn(fixture.bridge, 'async');
    await run('plain.cjs', 'console.log(42);');
    expect(
      asyncRequests.mock.calls.filter(
        ([request]) =>
          request.kind === 'fs' && request.op === 'readFile' && request.path.endsWith('/plain.cjs')
      )
    ).toHaveLength(1);
    expect(asyncRequests.mock.calls.some(([request]) => request.kind === 'transpile')).toBe(false);
    expect(
      asyncRequests.mock.calls.some(
        ([request]) => request.kind === 'fs' && request.path.includes('/.cache/')
      )
    ).toBe(false);
    expect(errors).toHaveLength(0);
  });

  it('keeps import and require conditions distinct for the same package in one module', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/node_modules/dual/package.json`,
      JSON.stringify({ exports: { import: './module.mjs', require: './common.cjs' } })
    );
    await fixture.writeFile(
      `${fixture.rootPath}/node_modules/dual/module.mjs`,
      'export default "import branch";'
    );
    await fixture.writeFile(
      `${fixture.rootPath}/node_modules/dual/common.cjs`,
      'module.exports = "require branch";'
    );
    await run(
      'dual.mjs',
      'import imported from "dual"; const required = require("dual"); console.log(imported, required);'
    );
    expect(output.join('\n')).toContain('import branch require branch');
    expect(errors).toHaveLength(0);
  });

  it('imports CommonJS defaults as whole exports even with a Babel __esModule marker', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/marked.cjs`,
      'module.exports = { __esModule: true, default: "nested", value: "whole exports" };'
    );
    await run(
      'commonjs-default.mjs',
      'import imported from "./marked.cjs"; console.log(imported.value, imported.default);'
    );
    expect(output.join('\n')).toContain('whole exports nested');
    expect(errors).toHaveLength(0);
  });

  it('preserves function-valued ESM default exports', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/function.mjs`,
      'export default function value() { return "function default"; }'
    );
    await run('function-default.mjs', 'import value from "./function.mjs"; console.log(value());');
    expect(output.join('\n')).toContain('function default');
    expect(errors).toHaveLength(0);
  });

  it('routes Function imports from dynamic strings and preserves shadowed Function constructors', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/dynamic-module.mjs`,
      'export const value = "dynamic function loaded";'
    );
    await run(
      'function-import.cjs',
      [
        'const Constructor = Function;',
        'const body = ["return ", "import(name)"].join("");',
        'const load = Constructor("name", body);',
        'module.exports.__promise = load("./dynamic-module.mjs").then(module => console.log(module.value));',
        'function local(Function) { return new Function(); }',
        'function Local() { this.value = "local constructor"; }',
        'console.log(local(Local).value);',
      ].join('\n')
    );
    expect(output.join('\n')).toContain('dynamic function loaded');
    expect(output.join('\n')).toContain('local constructor');
    expect(errors).toHaveLength(0);
  });

  it('waits for unreturned Function imports and normalizes builtin import namespaces', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/unreturned.mjs`,
      'export const value = "unreturned import completed";'
    );
    await run(
      'unreturned-function.cjs',
      [
        `new Function('return import("./unreturned.mjs")')().then(module => console.log(module.value));`,
        'import("node:fs").then(module => console.log(typeof module.default.readFileSync));',
      ].join('\n')
    );
    expect(output.join('\n')).toContain('unreturned import completed');
    expect(output.join('\n')).toContain('function');
    expect(errors).toHaveLength(0);
  });

  it('transforms erased type-only declarations in explicitly CommonJS TypeScript', async () => {
    await run(
      'types.cts',
      'import type Shape from "missing-types"; export interface Item { value: number } const value: number = 3; console.log(value);'
    );
    expect(output.join('\n')).toContain('3');
    expect(errors).toHaveLength(0);
  });

  it('preserves local process and filename declarations in ESM source and required modules', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/local.mjs`,
      'const process = { version: "local" }; const __filename = "source name"; export default `${process.version} ${__filename}`;'
    );
    await run(
      'local-bindings.mjs',
      'import value from "./local.mjs"; const __filename = "entry name"; console.log(value, __filename);'
    );
    expect(output.join('\n')).toContain('local source name entry name');
    expect(errors).toHaveLength(0);
  });

  it('applies explicit mjs and cjs formats before enclosing package type', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/package.json`,
      JSON.stringify({ type: 'commonjs' })
    );
    await run('module.mjs', 'export const value = 1; console.log(value);');
    expect(fixture.runtime.getExitCode()).toBe(0);
    await expect(run('invalid.cjs', 'export const value = 1;')).rejects.toThrow(
      'ES module syntax is not allowed'
    );
  });

  it('honors a type commonjs package for js files instead of syntax-based conversion', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/package.json`,
      JSON.stringify({ type: 'commonjs' })
    );
    await expect(run('invalid-type.js', 'export const value = 1;')).rejects.toThrow(
      'ES module syntax is not allowed'
    );
  });

  it('loads empty required modules without treating code as missing', async () => {
    await fixture.writeFile(`${fixture.rootPath}/empty.js`, '');
    await run('empty-entry.js', 'console.log(Object.keys(require("./empty")).length);');
    expect(output.join('\n')).toContain('0');
    expect(errors).toHaveLength(0);
  });

  it('preserves reassigned exports while resolving a circular require', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/cycle-a.js`,
      [
        "module.exports = { marker: 'ready' };",
        "module.exports.observed = require('./cycle-b').observed;",
      ].join('\n')
    );
    await fixture.writeFile(
      `${fixture.rootPath}/cycle-b.js`,
      "exports.observed = require('./cycle-a').marker;"
    );

    await run('cycle-main.js', "console.log(require('./cycle-a').observed);");

    expect(output.join('\n')).toContain('ready');
    expect(errors).toHaveLength(0);
  });

  it('stops a timer callback at process.exit and keeps its exit code', async () => {
    await run(
      'timer-exit.js',
      "setTimeout(() => { console.log('before timer exit'); process.exit(4); console.log('after timer exit'); }, 0);"
    );

    expect(fixture.runtime.getExitCode()).toBe(4);
    expect(output.join('\n')).toContain('before timer exit');
    expect(output.join('\n')).not.toContain('after timer exit');
  });

  it('reports SIGINT process.exit while unresolved module work keeps execute pending', async () => {
    let reportExit: ((code: number) => void) | undefined;
    const exitReported = new Promise<number>(resolve => {
      reportExit = resolve;
    });
    fixture.close();
    fixture = await createNodeRuntimeFixture(
      '/tmp/runtime-interrupt-tests',
      {
        log: (...args) => output.push(args.map(String).join(' ')),
        error: (...args) => errors.push(args.map(String).join(' ')),
        warn: (...args) => output.push(args.map(String).join(' ')),
        clear: () => {},
      },
      undefined,
      code => reportExit?.(code)
    );
    const path = `${fixture.rootPath}/interrupt.js`;
    await fixture.writeFile(
      path,
      [
        "process.on('SIGINT', () => process.exit(130));",
        "console.log('interrupt handler ready');",
        'module.exports.__promise = new Promise(() => {});',
      ].join('\n')
    );

    let executionSettled = false;
    void fixture.runtime.execute(path).then(() => {
      executionSettled = true;
    });
    await vi.waitFor(() => expect(output.join('\n')).toContain('interrupt handler ready'));

    expect(fixture.runtime.interrupt()).toBe(true);
    await expect(exitReported).resolves.toBe(130);
    await vi.waitFor(() => expect(executionSettled).toBe(true));
    expect(fixture.runtime.getExitCode()).toBe(130);
  });

  it('waits for setImmediate output scheduled by a required module', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/deferred.js`,
      [
        "setImmediate(() => console.log('dependency immediate output'));",
        'module.exports = true;',
      ].join('\n')
    );
    await run('immediate.js', "require('./deferred');");

    expect(output.join('\n')).toContain('dependency immediate output');
    expect(fixture.runtime.getExitCode()).toBe(0);
  });

  it('waits for timer callbacks before returning from the event loop', async () => {
    await run('timer.js', "setTimeout(() => console.log('timer completed'), 5);");

    expect(output.join('\n')).toContain('timer completed');
    expect(fixture.runtime.getExitCode()).toBe(0);
  });
});
