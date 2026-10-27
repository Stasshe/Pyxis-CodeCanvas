import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../../_helpers/nodeRuntime';

describe('ESM evaluation', () => {
  let fixture: NodeRuntimeFixture;
  let output: string[];

  beforeEach(async () => {
    output = [];
    fixture = await createNodeRuntimeFixture('/tmp/esm-evaluation', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: () => {},
      warn: () => {},
      clear: () => {},
    });
  });

  afterEach(() => fixture.close());

  async function write(name: string, source: string): Promise<void> {
    await fixture.writeFile(`${fixture.rootPath}/${name}`, source);
  }

  async function run(name: string, source: string): Promise<void> {
    await write(name, source);
    await fixture.runtime.execute(`${fixture.rootPath}/${name}`);
    await fixture.runtime.waitForEventLoop();
  }

  it('waits for top-level await in the entry', async () => {
    await run(
      'entry.mjs',
      `
      console.log('entry start');
      const value = await new Promise(resolve => setTimeout(() => resolve(42), 0));
      console.log('entry value', value);
    `
    );
    expect(output).toEqual(['entry start', 'entry value 42']);
  });

  it('awaits static dependency exports before running an importer without its own await', async () => {
    await write(
      'dependency.mjs',
      `
      console.log('dependency start');
      export const value = await new Promise(resolve => setTimeout(() => resolve(42), 0));
      console.log('dependency done');
    `
    );
    await run(
      'entry.mjs',
      `
      import { value } from './dependency.mjs';
      console.log('entry value', value);
    `
    );
    expect(output).toEqual(['dependency start', 'dependency done', 'entry value 42']);
  });

  it('starts sibling dependencies while an earlier dependency is suspended', async () => {
    await write(
      'slow.mjs',
      `
      console.log('slow start');
      await new Promise(resolve => setTimeout(resolve, 0));
      console.log('slow done');
    `
    );
    await write('sibling.mjs', "console.log('sibling');");
    await run(
      'entry.mjs',
      `
      import './slow.mjs';
      import './sibling.mjs';
      console.log('entry');
    `
    );
    expect(output).toEqual(['slow start', 'sibling', 'slow done', 'entry']);
  });

  it('awaits re-exported dependencies', async () => {
    await write('value.mjs', 'export const value = await Promise.resolve(7);');
    await write('index.mjs', "export { value } from './value.mjs';");
    await run('entry.mjs', "import { value } from './index.mjs'; console.log(value);");
    expect(output).toEqual(['7']);
  });

  it('shares a single evaluation for concurrent dynamic imports from CommonJS', async () => {
    await write(
      'value.mjs',
      `
      console.log('evaluated');
      export const value = await Promise.resolve(9);
    `
    );
    await run(
      'entry.cjs',
      `
      module.exports.__promise = Promise.all([import('./value.mjs'), import('./value.mjs')])
        .then(([first, second]) => console.log(first === second, first.value));
    `
    );
    expect(output).toEqual(['evaluated', 'true 9']);
  });

  it('supports nested await and top-level for-await', async () => {
    await run(
      'entry.mjs',
      `
      const value = await (await Promise.resolve(Promise.resolve(3)));
      const items = [];
      for await (const item of [Promise.resolve(value), Promise.resolve(4)]) items.push(item);
      console.log(items.join(','));
    `
    );
    expect(output).toEqual(['3,4']);
  });

  it('uses resolved values in chained expressions after dynamically importing an async module', async () => {
    await write(
      'precedence.mjs',
      `
      import { Buffer } from 'node:buffer';
      export const method = (await Promise.resolve(Buffer.from('resolved'))).toString();
      export const property = (await Promise.resolve({ value: 7 })).value;
      export const indexed = (await Promise.resolve(['item']))[0];
      export const called = (await Promise.resolve(() => 'called'))();
      export const optional = (await Promise.resolve({ value: 9 }))?.value;
      export const nested = (await (await Promise.resolve({ value: 11 }))).value;
      `
    );
    await run(
      'entry.cjs',
      `
      module.exports.__promise = import('./precedence.mjs').then(value => {
        console.log(value.method, value.property, value.indexed, value.called, value.optional, value.nested);
      });
      `
    );
    expect(output).toEqual(['resolved 7 item called 9 11']);
  });

  it('awaits a chained expression in a statically imported dependency', async () => {
    await write(
      'dependency.mjs',
      "export const value = (await Promise.resolve('resolved')).toUpperCase();"
    );
    await run('entry.mjs', "import { value } from './dependency.mjs'; console.log(value);");
    expect(output).toEqual(['RESOLVED']);
  });

  it('waits for an eager synchronous re-export shared by an async importer', async () => {
    await write('leaf.mjs', "export const value = 'shared';");
    await write('barrel.mjs', "export { value } from './leaf.mjs';");
    await write(
      'sibling.mjs',
      "import { value } from './barrel.mjs'; export const sibling = value;"
    );
    await run(
      'entry.mjs',
      `
      import { value } from './barrel.mjs';
      import { sibling } from './sibling.mjs';
      await Promise.resolve();
      console.log(value, sibling);
      `
    );
    expect(output).toEqual(['shared shared']);
  });

  it('keeps computed method keys in the outer async evaluation scope', async () => {
    await run(
      'computed-methods.mjs',
      `
      const object = {
        async [await Promise.resolve('execute')]() {
          await Promise.resolve();
          return 7;
        },
      };
      class Methods {
        async [await Promise.resolve('run')]() {
          await Promise.resolve();
          return 35;
        }
      }
      console.log(await object.execute() + await new Methods().run());
    `
    );
    expect(output).toEqual(['42']);
  });

  it('rejects require of an async graph without executing any module in it', async () => {
    await write(
      'value.mjs',
      "console.log('must not run'); export const value = await Promise.resolve(1);"
    );
    await write('index.mjs', "export { value } from './value.mjs';");
    await run(
      'entry.cjs',
      `
      try { require('./index.mjs'); } catch (error) { console.log(error.code); }
    `
    );
    expect(output).toEqual(['ERR_REQUIRE_ASYNC_MODULE']);
  });

  it('keeps CommonJS require and synchronous ESM graphs synchronous', async () => {
    await write('common.cjs', "module.exports = { value: 'common' };");
    await write('sync.mjs', "export const value = 'sync';");
    await run(
      'entry.cjs',
      `
      console.log(require('./common.cjs').value);
      console.log(require('./sync.mjs').value);
      console.log('after require');
    `
    );
    expect(output).toEqual(['common', 'sync', 'after require']);
  });

  it('executes hashbangs in synchronous ESM entries and dependencies', async () => {
    await write('dependency.mjs', '#!/usr/bin/env node\nexport const value = 42;');
    await run(
      'entry.mjs',
      '#!/usr/bin/env node\nimport { value } from "./dependency.mjs"; console.log(value);'
    );

    expect(output).toEqual(['42']);
  });

  it('executes hashbangs in asynchronous ESM entries and dependencies', async () => {
    await write(
      'async-dependency.mjs',
      '#!/usr/bin/env node\nexport const value = await Promise.resolve(42);'
    );
    await run(
      'async-entry.mjs',
      '#!/usr/bin/env node\nimport { value } from "./async-dependency.mjs"; console.log(value); await Promise.resolve();'
    );

    expect(output).toEqual(['42']);
  });

  it('continues to execute a CommonJS entry hashbang', async () => {
    await run('entry.cjs', '#!/usr/bin/env node\nconsole.log("commonjs");');

    expect(output).toEqual(['commonjs']);
  });

  it('uses an ESM module.exports override for require while keeping import namespaces intact', async () => {
    await write(
      'constructor.cjs',
      `
      const cached = (function* () {}.constructor);
      module.exports = () => cached;
    `
    );
    await write(
      'bridge.mjs',
      `
      import constructor from './constructor.cjs';
      export default constructor;
      export { constructor as 'module.exports' };
    `
    );
    await run(
      'entry.cjs',
      `
      const constructor = require('./bridge.mjs');
      console.log(typeof constructor, constructor === require('./constructor.cjs'));
      console.log(constructor() === (function* () {}).constructor);
      console.log(new (constructor())('yield 7')().next().value);
      console.log(Function('return 8')());
      module.exports.__promise = import('./bridge.mjs').then(namespace => {
        console.log(namespace.default === constructor, namespace['module.exports'] === constructor);
      });
    `
    );
    expect(output).toEqual(['function true', 'true', '7', '8', 'true true']);
  });

  it('honors explicit undefined overrides and leaves CommonJS object properties intact', async () => {
    await write(
      'undefined.mjs',
      `
      const exported = undefined;
      export { exported as 'module.exports' };
      export default 'default must not replace undefined';
    `
    );
    await write(
      'ordinary.cjs',
      "module.exports = { 'module.exports': 'ordinary CommonJS property' };"
    );
    await run(
      'entry.cjs',
      `
      console.log(require('./undefined.mjs') === undefined);
      console.log(require('./ordinary.cjs')['module.exports']);
    `
    );
    expect(output).toEqual(['true', 'ordinary CommonJS property']);
  });

  it('does not mark dynamic-only async imports as a synchronous graph dependency', async () => {
    await write('async.mjs', 'export const value = await Promise.resolve(5);');
    await write('sync.mjs', "export const pending = import('./async.mjs');");
    await run(
      'entry.cjs',
      `
      const namespace = require('./sync.mjs');
      console.log('required');
      module.exports.__promise = namespace.pending.then(value => console.log(value.value));
    `
    );
    expect(output).toEqual(['required', '5']);
  });

  it('rejects top-level await in explicit CommonJS', async () => {
    await write('entry.cjs', 'await Promise.resolve();');
    await expect(fixture.runtime.execute(`${fixture.rootPath}/entry.cjs`)).rejects.toThrow(
      SyntaxError
    );
  });

  it('propagates rejected entry and dependency evaluation', async () => {
    await write('rejected.mjs', "await Promise.reject(new Error('dependency rejection'));");
    await write('entry.mjs', "import './rejected.mjs'; console.log('must not run');");
    await expect(fixture.runtime.execute(`${fixture.rootPath}/entry.mjs`)).rejects.toThrow(
      'dependency rejection'
    );
    expect(output).toEqual([]);
  });

  it('retains the rejection and does not repeat a failed dynamic evaluation', async () => {
    await write(
      'rejected.mjs',
      "console.log('evaluated'); await Promise.reject(new Error('rejection'));"
    );
    await run(
      'entry.cjs',
      `
      module.exports.__promise = (async () => {
        let first;
        try { await import('./rejected.mjs'); } catch (error) { first = error; }
        try { await import('./rejected.mjs'); } catch (error) { console.log(first === error, error.message); }
      })();
    `
    );
    expect(output).toEqual(['evaluated', 'true rejection']);
  });

  it('links hoisted function exports through an async static cycle', async () => {
    await write(
      'cycle-b.mjs',
      `
      import { marker } from './cycle-a.mjs';
      await Promise.resolve();
      export const value = marker();
    `
    );
    await run(
      'cycle-a.mjs',
      `
      import { value } from './cycle-b.mjs';
      export function marker() { return 'cycle value'; }
      console.log(value);
    `
    );
    expect(output).toEqual(['cycle value']);
  });
});
