import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('NodeRuntime natural process exit', () => {
  let fixture: NodeRuntimeFixture;
  const output: string[] = [];

  beforeEach(async () => {
    output.length = 0;
    fixture = await createNodeRuntimeFixture('/tmp/natural-exit-tests', {
      log: (...args) => output.push(args.map(String).join(' ')),
      error: () => {},
      warn: () => {},
      clear: () => {},
    });
  });

  afterEach(() => {
    fixture.close();
  });

  it('emits exit once after tracked I/O and blocks new timers in listeners', async () => {
    const entry = `${fixture.rootPath}/entry.js`;
    await fixture.writeFile(entry, 'tracked output');
    await fixture.writeFile(
      `${fixture.rootPath}/main.js`,
      [
        "const fs = require('fs');",
        `fs.promises.readFile('${entry}', 'utf8').then(value => console.log(value));`,
        "process.on('exit', code => {",
        "  console.log('natural exit', code);",
        "  setTimeout(() => console.log('late timer'), 0);",
        '});',
      ].join('\n')
    );

    await fixture.runtime.execute(`${fixture.rootPath}/main.js`);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual(['tracked output', 'natural exit 0']);
    expect(fixture.runtime.getExitCode()).toBe(0);
  });

  it('keeps an unset guest exitCode undefined through natural exit and resets internal status', async () => {
    await fixture.writeFile(
      `${fixture.rootPath}/main.js`,
      [
        "console.log('initial', process.exitCode);",
        'process.exitCode = 1;',
        'process.exitCode = undefined;',
        "process.on('beforeExit', code => console.log('beforeExit', code, process.exitCode));",
        "process.on('exit', code => console.log('exit', code, process.exitCode));",
      ].join('\n')
    );

    await fixture.runtime.execute(`${fixture.rootPath}/main.js`);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual(['initial undefined', 'beforeExit 0 undefined', 'exit 0 undefined']);
    expect(fixture.runtime.getExitCode()).toBe(0);
  });

  it.each([
    {
      name: 'uses assigned exitCode when exit() omits its argument',
      source:
        "process.exitCode ??= 1; process.on('exit', code => console.log(code, process.exitCode)); process.exit();",
      output: ['1 1'],
      exitCode: 1,
    },
    {
      name: 'lets an explicit exit argument override exitCode',
      source:
        "process.exitCode = 1; process.on('exit', code => console.log(code, process.exitCode)); process.exit(0);",
      output: ['0 0'],
      exitCode: 0,
    },
    {
      name: 'resets exitCode when assigned null',
      source:
        "process.exitCode = 3; process.exitCode = null; process.on('exit', code => console.log(code, process.exitCode));",
      output: ['0 undefined'],
      exitCode: 0,
    },
    {
      name: 'resets exitCode when process.exit receives null',
      source:
        "process.exitCode = 3; process.on('exit', code => console.log(code, process.exitCode)); process.exit(null);",
      output: ['0 undefined'],
      exitCode: 0,
    },
    {
      name: 'converts numeric strings while preserving an unnormalized number property',
      source:
        "process.exitCode = '257'; console.log(process.exitCode); process.on('exit', code => console.log(code, process.exitCode));",
      output: ['257', '257 257'],
      exitCode: 1,
    },
    {
      name: 'converts numeric strings on explicit exit',
      source:
        "process.on('exit', code => console.log(code, process.exitCode)); process.exit('257');",
      output: ['257 257'],
      exitCode: 1,
    },
    {
      name: 'preserves raw wraparound values on the guest property',
      source:
        "process.exitCode = 256; process.on('beforeExit', code => console.log('beforeExit', code, process.exitCode)); process.on('exit', code => console.log(code, process.exitCode));",
      output: ['beforeExit 256 256', '256 256'],
      exitCode: 0,
    },
    {
      name: 'preserves negative raw values on the guest property',
      source:
        "process.exitCode = -1; process.on('beforeExit', code => console.log('beforeExit', code, process.exitCode)); process.on('exit', code => console.log(code, process.exitCode));",
      output: ['beforeExit -1 -1', '-1 -1'],
      exitCode: 255,
    },
    {
      name: 'rejects invalid assignments without changing the previous exit status',
      source:
        "process.exitCode = 7; try { process.exitCode = 1.5; } catch (error) { console.log(error.code); } try { process.exitCode = 'NaN'; } catch (error) { console.log(error.code); } try { process.exitCode = NaN; } catch (error) { console.log(error.code); } process.on('exit', code => console.log(code, process.exitCode));",
      output: ['ERR_OUT_OF_RANGE', 'ERR_INVALID_ARG_TYPE', 'ERR_OUT_OF_RANGE', '7 7'],
      exitCode: 7,
    },
    {
      name: 'rejects an invalid explicit exit argument without changing status',
      source:
        "process.exitCode = 7; try { process.exit(1.5); } catch (error) { console.log(error.code); } process.on('exit', code => console.log(code, process.exitCode));",
      output: ['ERR_OUT_OF_RANGE', '7 7'],
      exitCode: 7,
    },
  ])('$name', async ({ source, output: expectedOutput, exitCode }) => {
    await fixture.writeFile(`${fixture.rootPath}/main.js`, source);

    await fixture.runtime.execute(`${fixture.rootPath}/main.js`);
    await fixture.runtime.waitForEventLoop();

    expect(output).toEqual(expectedOutput);
    expect(fixture.runtime.getExitCode()).toBe(exitCode);
  });
});
