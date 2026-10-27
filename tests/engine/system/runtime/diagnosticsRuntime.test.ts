import { afterEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../../_helpers/nodeRuntime';

describe('NodeRuntime diagnostics_channel builtin', () => {
  let fixture: NodeRuntimeFixture;

  afterEach(async () => {
    await fixture?.close();
  });

  it('resolves both builtin names to the runtime-local diagnostics module', async () => {
    const output: string[] = [];
    fixture = await createNodeRuntimeFixture('/tmp/diagnostics-runtime', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: (...args) => output.push(args.map(String).join(' ')),
      warn: (...args) => output.push(args.map(String).join(' ')),
      clear: () => {},
    });
    const entryPath = `${fixture.rootPath}/entry.js`;
    await fixture.writeFile(
      entryPath,
      [
        "const plain = require('diagnostics_channel');",
        "const prefixed = require('node:diagnostics_channel');",
        'console.log(plain === prefixed);',
        "console.log(plain.channel('runtime:shared') === prefixed.channel('runtime:shared'));",
        "console.log(plain.hasSubscribers('runtime:shared'));",
      ].join('\n')
    );

    await fixture.runtime.execute(entryPath, []);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual(['true', 'true', 'false']);
  });
});
