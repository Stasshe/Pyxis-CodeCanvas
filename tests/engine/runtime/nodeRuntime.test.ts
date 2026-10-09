import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { isRetiredRuntimePromise } from '@/engine/runtime/nodejs/nodeRuntime';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

const hostTimeout = globalThis.setTimeout;

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
    expect(globalThis.setTimeout).toBe(hostTimeout);
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

  it('executes inline source without requiring an entry file', async () => {
    await fixture.writeFile(`${fixture.rootPath}/package.json`, '{"type":"module"}');
    await fixture.runtime.execute(
      `${fixture.rootPath}/[eval]`,
      ['argument'],
      'console.log(JSON.stringify(process.argv), JSON.stringify(process.execArgv), process.execPath, __filename, __dirname, this === globalThis, typeof require);',
      ['--eval', 'inline source']
    );
    await fixture.runtime.waitForEventLoop();

    expect(output.join('\n')).toContain(
      '["node","argument"] ["--eval","inline source"] node [eval] . true function'
    );
  });

  it('defaults detached stdout and stderr streams to non-TTY', async () => {
    await run('stdio-tty.js', 'console.log(process.stdout.isTTY, process.stderr.isTTY);');

    expect(output).toContain('false false');
  });

  it('changes cwd only to an existing directory in the runtime filesystem', async () => {
    await fixture.fs.mkdir(`${fixture.rootPath}/nested`, { recursive: true });
    await run(
      'chdir.js',
      `process.chdir('${fixture.rootPath}/nested'); console.log(process.cwd());`
    );

    expect(output).toContain(`${fixture.rootPath}/nested`);
  });

  it('emits warning events and writes warning details to stderr', async () => {
    await run(
      'warning.js',
      [
        "process.on('warning', warning => console.log(warning.name, warning.code));",
        "process.emitWarning('notice', { type: 'CustomWarning', code: 'W1', detail: 'extra detail' });",
      ].join('\n')
    );

    expect(output).toContain('CustomWarning W1');
    expect(errors.join('\n')).toContain('extra detail');
  });

  it('loads node:string_decoder and reports the runtime architecture', async () => {
    await run(
      'string-decoder.js',
      [
        "const { StringDecoder } = require('node:string_decoder');",
        "const decoder = new StringDecoder('utf8');",
        'const first = decoder.write(Buffer.from([0xe7, 0x8c]));',
        "console.log(first + decoder.end(Buffer.from([0xab])), process.arch, require('os').arch());",
      ].join('\n')
    );

    expect(output.join('\n')).toContain('猫 x64 x64');
    expect(errors).toHaveLength(0);
  });

  it('resolves node:querystring through the runtime builtin map', async () => {
    await run(
      'querystring.js',
      [
        "const querystring = require('node:querystring');",
        "console.log(JSON.stringify(querystring.decode('q=hello+world&tag=a&tag=b')));",
        'console.log(querystring.encode === querystring.stringify);',
      ].join('\n')
    );

    expect(output.join('\n')).toContain('{"q":"hello world","tag":["a","b"]}');
    expect(output.join('\n')).toContain('true');
    expect(errors).toHaveLength(0);
  });

  it('preserves host globals inherited by the runtime global object', async () => {
    await run('inherited-globals.js', 'console.log(globalThis.Infinity === Infinity);');

    expect(output.join('\n')).toContain('true');
  });

  it('keeps builtin module identities stable across aliases', async () => {
    await run(
      'builtin-identity.js',
      [
        "const path = require('path');",
        "console.log(path === require('node:path'), path.posix === require('path/posix'));",
        "console.log(path.win32 === require('path/win32'), path.win32.sep, path.win32.win32 === path.win32, path.win32.posix === path.posix);",
        'console.log(path.win32.toNamespacedPath(null));',
        "console.log(require('process') === require('node:process'));",
        "console.log(require('timers/promises') === require('node:timers/promises'));",
      ].join('\n')
    );

    expect(output.join('\n')).toContain('true true');
    expect(output.join('\n')).toContain('true \\ true true');
    expect(output).toContain('null');
    expect(output.join('\n')).toContain('true');
  });

  it('tracks nextTick and queueMicrotask work before timers', async () => {
    await run(
      'microtasks.js',
      [
        "process.nextTick(() => console.log('next tick'));",
        "queueMicrotask(() => { console.log('microtask'); queueMicrotask(() => console.log('nested')); });",
        "setTimeout(() => console.log('timer'), 0);",
      ].join('\n')
    );

    expect(output).toEqual(['next tick', 'microtask', 'nested', 'timer']);
  });

  it('drains nested nextTick callbacks before Promise reactions queued by a tick', async () => {
    await run(
      'nested-next-tick.js',
      [
        "process.nextTick(() => { console.log('tick'); process.nextTick(() => console.log('nested tick')); Promise.resolve().then(() => console.log('tick promise')); });",
        "Promise.resolve().then(() => console.log('initial promise'));",
      ].join('\n')
    );

    expect(output).toEqual(['tick', 'nested tick', 'initial promise', 'tick promise']);
  });

  it('runs setImmediate on its own cancellable task handle', async () => {
    await run(
      'immediate.js',
      [
        "setImmediate(value => console.log(value), 'immediate');",
        "const canceled = setImmediate(() => console.log('canceled'));",
        'clearImmediate(canceled);',
      ].join('\n')
    );

    expect(output).toEqual(['immediate']);
  });

  it('repeats beforeExit when its listener schedules tracked work', async () => {
    await run(
      'before-exit.js',
      [
        'let count = 0;',
        "process.on('beforeExit', () => { count += 1; console.log('beforeExit', count); if (count === 1) setTimeout(() => console.log('work'), 0); });",
      ].join('\n')
    );

    expect(output).toEqual(['beforeExit 1', 'work', 'beforeExit 2']);
  });

  it('offers synchronous execution errors to uncaughtException listeners', async () => {
    await run(
      'uncaught-exception.js',
      "process.on('uncaughtException', error => console.log('handled', error.message)); throw new Error('sync');"
    );

    expect(output).toContain('handled sync');
    expect(errors).toHaveLength(0);
  });

  it('loads callable assert and the strict assertion builtin alias', async () => {
    await run(
      'assert.js',
      [
        "const assert = require('assert');",
        "const strictAssert = require('node:assert/strict');",
        'console.log(typeof assert, strictAssert === assert.strict);',
        "try { strictAssert.equal(1, '1'); } catch { console.log('strict equality'); }",
      ].join('\n')
    );

    expect(output.join('\n')).toContain('function true');
    expect(output.join('\n')).toContain('strict equality');
    expect(errors).toHaveLength(0);
  });

  it('resolves node:net address helpers without exposing socket APIs', async () => {
    await run(
      'net.js',
      [
        "const net = require('node:net');",
        "console.log(net.isIP('127.0.0.1'), net.isIPv4('127.000.000.001'));",
        "console.log(net.isIP('::ffff:192.0.2.1'), net.isIPv6('fe80::1%eth0'));",
        'console.log(typeof net.createServer, typeof net.Socket);',
      ].join('\n')
    );

    expect(output.join('\n')).toContain('4 false');
    expect(output.join('\n')).toContain('6 true');
    expect(output.join('\n')).toContain('undefined undefined');
    expect(errors).toHaveLength(0);
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

  it('completes the event loop after PBKDF2 rejects invalid input synchronously', async () => {
    await run(
      'invalid-pbkdf2.js',
      [
        "const { pbkdf2 } = require('crypto');",
        "try { pbkdf2('password', 'salt', -1, 16, 'sha256', () => {}); }",
        'catch (error) { console.log(error.name); }',
      ].join('\n')
    );

    expect(output.join('\n')).toContain('TypeError');
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

  it('does not resolve a string-valued default export as a dependency', async () => {
    await fixture.writeFile(`${fixture.rootPath}/default-value.mjs`, "export default 'default';");
    await run(
      'default-value-entry.mjs',
      'import value from "./default-value.mjs"; console.log(value);'
    );

    expect(output.join('\n')).toContain('default');
    expect(errors).toHaveLength(0);
  });

  it('loads namespace re-exports whose exported name is reserved', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/namespace-base.mjs`,
      'export const value = "loaded";'
    );
    await fixture.writeFile(
      `${fixture.rootPath}/namespace.mjs`,
      "export * as default from './namespace-base.mjs';"
    );
    await run(
      'namespace-entry.mjs',
      'import namespace from "./namespace.mjs"; console.log(namespace.value);'
    );

    expect(output.join('\n')).toContain('loaded');
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

  it('loads empty required modules without treating code as missing', async () => {
    await fixture.writeFile(`${fixture.rootPath}/empty.js`, '');
    await run('empty-entry.js', 'console.log(Object.keys(require("./empty")).length);');
    expect(output.join('\n')).toContain('0');
    expect(errors).toHaveLength(0);
  });

  it('loads a symlinked entry and dependencies from its real directory', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/real/node_modules/local/index.js`,
      "module.exports = 'real dependency';"
    );
    await fixture.writeFile(
      `${fixture.rootPath}/real/entry.js`,
      `console.log(require('local'), __filename, module.filename, process.argv[1]);
       console.log(require('../alias') === module.exports);`
    );
    await fixture.fs.symlink('./real/entry.js', `${fixture.rootPath}/alias.js`);
    await fixture.runtime.execute(`${fixture.rootPath}/alias.js`, []);
    expect(output.join('\n')).toContain(
      `real dependency ${fixture.rootPath}/real/entry.js ${fixture.rootPath}/real/entry.js ${fixture.rootPath}/alias.js`
    );
    expect(output.join('\n')).toContain('true');
  });

  it('shares the cache and searches real ancestors for linked packages', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/packages/node_modules/nested/index.js`,
      "module.exports = 'target dependency';"
    );
    await fixture.writeFile(
      `${fixture.rootPath}/packages/tool/index.js`,
      "console.log('target loaded'); module.exports = { value: require('nested'), filename: module.filename };"
    );
    await fixture.fs.mkdir(`${fixture.rootPath}/node_modules`, { recursive: true });
    await fixture.fs.symlink('../packages/tool', `${fixture.rootPath}/node_modules/tool`);
    await run(
      'linked-package.js',
      `
      const linked = require('tool');
      const direct = require('./packages/tool');
      console.log(linked === direct, linked.value, linked.filename);
    `
    );
    const combined = output.join('\n');
    expect(combined).toContain(`true target dependency ${fixture.rootPath}/packages/tool/index.js`);
    expect(output.filter(line => line === 'target loaded')).toHaveLength(1);
  });

  it('lets a directory loader require files relative to the supplied module', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/loader/index.js`,
      `module.exports = function(caller, directory) {
        const fs = require('fs');
        const path = require('path');
        const files = fs.readdirSync(path.resolve(path.dirname(caller.filename), directory));
        return files.map(file => caller.require(path.resolve(path.dirname(caller.filename), directory, file)));
      };`
    );
    await fixture.writeFile(`${fixture.rootPath}/handlers/one.js`, "module.exports = 'handler';");
    await fixture.writeFile(
      `${fixture.rootPath}/nested/handlers/one.js`,
      "module.exports = 'nested handler';"
    );
    await fixture.writeFile(
      `${fixture.rootPath}/nested/caller.js`,
      "module.exports = require('../loader')(module, './handlers');"
    );
    await run(
      'directory-main.js',
      `
      const loader = require('./loader');
      console.log(loader(module, './handlers').join(','));
      console.log(module.require('./nested/caller').join(','));
      console.log(module.require('./directory-main') === module.exports);
      console.log(module.children.map(child => child.filename).join(','));
    `
    );
    const combined = output.join('\n');
    expect(combined).toContain('handler');
    expect(combined).toContain('nested handler');
    expect(combined).toContain('true');
    expect(combined).toContain(`${fixture.rootPath}/handlers/one.js`);
    expect(combined).toContain(`${fixture.rootPath}/nested/caller.js`);
  });

  it('exposes CommonJS filenames, parent relationships and load state', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/metadata-child.js`,
      `exports.duringLoad = module.loaded;
       exports.parent = module.parent;
       exports.module = module;
       exports.paths = module.paths;`
    );
    await run(
      'metadata-main.js',
      `
      const child = require('./metadata-child');
      console.log(module.id, module.filename === __filename, module.loaded);
      console.log(child.module.id === child.module.filename, child.module.loaded, child.duringLoad);
      console.log(child.parent === module, module.children[0] === child.module);
      console.log(child.paths.join(','));
    `
    );
    const combined = output.join('\n');
    expect(combined).toContain('. true false');
    expect(combined).toContain('true true false');
    expect(combined).toContain('true true');
    expect(combined).toContain('/tmp/runtime-tests/node_modules,/tmp/node_modules,/node_modules');
  });

  it('keeps entry partial exports available during circular require', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/entry-child.js`,
      "module.exports = require('./entry-cycle').marker;"
    );
    await run(
      'entry-cycle.js',
      `
      exports.marker = 'entry partial';
      console.log(require('./entry-child'));
    `
    );
    expect(output.join('\n')).toContain('entry partial');
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
