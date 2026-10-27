import hostProcess, { nextTick } from 'node:process';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../../../_helpers/nodeRuntime';

describe('Runtime browser globals', () => {
  let fixture: NodeRuntimeFixture;

  afterEach(() => fixture.close());

  async function createFixture(output: string[]): Promise<void> {
    fixture = await createNodeRuntimeFixture('/tmp/runtime-globals', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: () => {},
      warn: () => {},
      clear: () => {},
    });
  }

  it('drains deferred guest nextTick restoration before returning to the host process', async () => {
    const originalNextTick = hostProcess.nextTick;
    await createFixture([]);
    const path = `${fixture.rootPath}/entry.js`;
    await fixture.writeFile(path, 'module.exports = 1;');
    await fixture.runtime.execute(path);
    const guestNextTick = globalThis.process.nextTick;

    // Vitest's RPC timer guard restores this captured guest value on a native tick.
    nextTick(() => {
      globalThis.process.nextTick = guestNextTick;
    });
    await fixture.close();

    expect(globalThis.process).toBe(hostProcess);
    expect(hostProcess.nextTick).toBe(originalNextTick);
  });

  it('preserves the host navigator in entries and dependencies without modifying its descriptor', async () => {
    const output: string[] = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    await createFixture(output);
    await fixture.writeFile(
      `${fixture.rootPath}/child.js`,
      `
      exports.same = globalThis.navigator === navigator;
      exports.userAgent = globalThis.navigator.userAgent;
    `
    );
    await fixture.writeFile(
      `${fixture.rootPath}/entry.mjs`,
      `
      import child from './child.js';
      await Promise.resolve();
      console.log(globalThis.navigator === navigator, child.same);
      console.log(globalThis.navigator.userAgent, child.userAgent);
    `
    );

    await fixture.runtime.execute(`${fixture.rootPath}/entry.mjs`);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual([
      'true true',
      `${globalThis.navigator.userAgent} ${globalThis.navigator.userAgent}`,
    ]);
    expect(Object.getOwnPropertyDescriptor(globalThis, 'navigator')).toEqual(originalDescriptor);
  });

  it('shares property and identifier bindings across entries, dependencies and Function bodies', async () => {
    const output: string[] = [];
    await createFixture(output);
    await fixture.writeFile(
      `${fixture.rootPath}/scope-child.js`,
      `
      PYXIS_SCOPE_PROPERTY.push('dependency');
      PYXIS_SCOPE_IDENTIFIER = 'implicit global';
      exports.read = () => PYXIS_SCOPE_PROPERTY.join(',');
      `
    );
    await fixture.writeFile(
      `${fixture.rootPath}/scope.js`,
      `
      globalThis.PYXIS_SCOPE_PROPERTY = ['entry'];
      PYXIS_SCOPE_PROPERTY.push('identifier');
      const child = require('./scope-child');
      console.log(child.read(), global.PYXIS_SCOPE_IDENTIFIER);
      console.log(Function('return PYXIS_SCOPE_PROPERTY === globalThis.PYXIS_SCOPE_PROPERTY')());
      delete globalThis.PYXIS_SCOPE_PROPERTY;
      delete globalThis.PYXIS_SCOPE_IDENTIFIER;
      console.log(typeof PYXIS_SCOPE_PROPERTY, typeof PYXIS_SCOPE_IDENTIFIER);
      `
    );

    await fixture.runtime.execute(`${fixture.rootPath}/scope.js`);
    await fixture.runtime.waitForEventLoop();
    fixture.runtime.dispose();

    expect(output).toEqual([
      'entry,identifier,dependency implicit global',
      'true',
      'undefined undefined',
    ]);
  });

  it('preserves host window and define globals in entries, dependencies and Function bodies', async () => {
    const names = ['window', 'define'];
    const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
    const windowValue = { runtimeGlobal: 'window' };
    const defineValue = () => 'define';
    const output: string[] = [];
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: windowValue,
      writable: true,
    });
    Object.defineProperty(globalThis, 'define', {
      configurable: true,
      value: defineValue,
      writable: true,
    });

    try {
      await createFixture(output);
      await fixture.writeFile(
        `${fixture.rootPath}/globals-child.js`,
        `
        exports.matches = window === globalThis.window && define === globalThis.define;
        exports.functionMatches = Function('return window === globalThis.window && define === globalThis.define')();
        `
      );
      await fixture.writeFile(
        `${fixture.rootPath}/globals.js`,
        `
        const child = require('./globals-child');
        console.log(window === globalThis.window, define === globalThis.define, child.matches, child.functionMatches);
        console.log(Function('return window === globalThis.window && define === globalThis.define')());
        `
      );

      await fixture.runtime.execute(`${fixture.rootPath}/globals.js`);
      await fixture.runtime.waitForEventLoop();
      expect(output).toEqual(['true true true true', 'true']);
    } finally {
      names.forEach((name, index) => {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else Reflect.deleteProperty(globalThis, name);
      });
    }
  });

  it('uses the actual host receiver for browser globals in async modules', async () => {
    const output: string[] = [];
    await createFixture(output);
    await fixture.writeFile(
      `${fixture.rootPath}/host.mjs`,
      `
      await Promise.resolve();
      console.log(global === globalThis, Function('return this')() === globalThis);
      if (typeof self !== 'undefined') console.log(globalThis === self);
      console.log(globalThis.crypto === crypto, globalThis.performance === performance);
      console.log(globalThis.crypto.getRandomValues(new Uint8Array(1)).length);
      console.log(typeof globalThis.performance.now());
      console.log(console === globalThis.console, process === globalThis.process);
      `
    );

    await fixture.runtime.execute(`${fixture.rootPath}/host.mjs`);
    await fixture.runtime.waitForEventLoop();
    fixture.runtime.dispose();

    expect(output).toContain('true true');
    expect(output).toContain('1');
    expect(output).toContain('number');
    expect(output.every(line => !line.includes('false'))).toBe(true);
  });

  it('restores owned descriptors while retaining program globals across executions', async () => {
    const names = [
      'global',
      'globalThis',
      'process',
      'Buffer',
      'console',
      'Function',
      'queueMicrotask',
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'setImmediate',
      'clearImmediate',
    ];
    const originals = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
    const output: string[] = [];
    await createFixture(output);
    await fixture.writeFile(
      `${fixture.rootPath}/first.mjs`,
      `
      const original = console;
      globalThis.PYXIS_SCOPE_PERSISTENT = 'first execution';
      globalThis.console = { ...console, log: value => original.log('replacement', value) };
      await Promise.resolve();
      console.log('bare identifier');
      Function('console.log("Function body")')();
      setTimeout(() => console.log('timer callback'), 0);
      `
    );
    await fixture.runtime.execute(`${fixture.rootPath}/first.mjs`);
    await fixture.runtime.waitForEventLoop();
    await fixture.close();

    expect(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))).toEqual(originals);
    expect(output).toEqual([
      'replacement bare identifier',
      'replacement Function body',
      'replacement timer callback',
    ]);

    await createFixture(output);
    await fixture.writeFile(
      `${fixture.rootPath}/second.js`,
      `
      console.log(PYXIS_SCOPE_PERSISTENT, process === globalThis.process);
      delete globalThis.PYXIS_SCOPE_PERSISTENT;
      `
    );
    await fixture.runtime.execute(`${fixture.rootPath}/second.js`);
    await fixture.runtime.waitForEventLoop();
    await fixture.close();

    expect(output).toContain('first execution true');
    expect(names.map(name => Object.getOwnPropertyDescriptor(globalThis, name))).toEqual(originals);
  });
});
