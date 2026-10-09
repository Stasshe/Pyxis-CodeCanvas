import { describe, expect, it } from 'vitest';
import { createWorkerThreadsModule } from '@/engine/runtime/nodejs/modules/workerThreadsModule';
import { createNodeRuntimeFixture } from '../../_helpers/nodeRuntime';

describe('Node worker_threads builtin', () => {
  it('reports Node main-thread metadata and the shared environment symbol', () => {
    const first = createWorkerThreadsModule();
    const second = createWorkerThreadsModule();

    expect(first.isMainThread).toBe(true);
    expect(first.isInternalThread).toBe(false);
    expect(first.threadId).toBe(0);
    expect(first.threadName).toBe('');
    expect(first.parentPort).toBeNull();
    expect(first.workerData).toBeNull();
    expect(first.resourceLimits).toEqual({});
    expect(first.SHARE_ENV).toBe(Symbol.for('nodejs.worker_threads.SHARE_ENV'));
    expect(first.SHARE_ENV).toBe(second.SHARE_ENV);
  });

  it('fails explicitly when guest code tries to create a worker', () => {
    const { Worker, SHARE_ENV } = createWorkerThreadsModule();

    expect(() => new Worker(new URL('file:///worker.js'), { env: SHARE_ENV })).toThrow(
      expect.objectContaining({
        code: 'ERR_FEATURE_UNAVAILABLE',
        message: 'worker_threads.Worker is unavailable in this runtime.',
      })
    );
  });

  it('loads the builtin through bare and node-prefixed runtime imports', async () => {
    const output: string[] = [];
    const fixture = await createNodeRuntimeFixture('/tmp/worker-threads-tests', {
      log: (...values) => output.push(values.map(String).join(' ')),
      error: (...values) => output.push(values.map(String).join(' ')),
      warn: (...values) => output.push(values.map(String).join(' ')),
      clear: () => {},
    });
    try {
      await fixture.writeFile(
        `${fixture.rootPath}/entry.cjs`,
        [
          "const prefixed = require('node:worker_threads');",
          "const bare = require('worker_threads');",
          'console.log(prefixed === bare, prefixed.SHARE_ENV === bare.SHARE_ENV, prefixed.isMainThread, prefixed.threadId);',
          "try { new prefixed.Worker('worker.js'); } catch (error) { console.log(error.code); }",
        ].join('\n')
      );
      await fixture.runtime.execute(`${fixture.rootPath}/entry.cjs`);
      await fixture.runtime.waitForEventLoop();

      expect(output.join('\n')).toContain('true true true 0');
      expect(output.join('\n')).toContain('ERR_FEATURE_UNAVAILABLE');
    } finally {
      await fixture.close();
    }
  });
});
