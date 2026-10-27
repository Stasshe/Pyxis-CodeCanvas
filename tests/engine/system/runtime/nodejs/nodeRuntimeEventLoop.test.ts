import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createNodeRuntimeFixture, type NodeRuntimeFixture } from '../../../../_helpers/nodeRuntime';

const hostTimeout = globalThis.setTimeout;

describe('NodeRuntime event loop execution', () => {
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

  afterEach(async () => {
    await fixture.close();
    expect(globalThis.setTimeout).toBe(hostTimeout);
  });

  async function run(name: string, source: string): Promise<void> {
    const path = `${fixture.rootPath}/${name}`;
    await fixture.writeFile(path, source);
    await fixture.runtime.execute(path, []);
    await fixture.runtime.waitForEventLoop();
  }

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
    await fixture.close();
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
