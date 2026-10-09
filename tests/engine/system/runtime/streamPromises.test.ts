import { createRequire } from 'node:module';
import nativeStream from 'node:stream';
import * as nativePromises from 'node:stream/promises';
import { describe, expect, it } from 'vitest';
import type { RuntimeExecutionOptions } from '@/engine/system/runtime/core/RuntimeProvider';
import { executeIsolatedNodeRuntime } from '../../../_helpers/isolatedNodeRuntime';

type StreamApi = Pick<typeof nativeStream, 'Readable' | 'Transform' | 'Writable'>;
type PromiseApi = Pick<typeof nativePromises, 'pipeline' | 'finished'>;

const require = createRequire(import.meta.url);
// The vendor package ships JavaScript without the native Node stream declarations.
const upstreamStream = require('readable-stream/lib/stream.js') as StreamApi;
const upstreamPromises = require('readable-stream/lib/stream/promises.js') as PromiseApi;

function collectPipeline(stream: StreamApi, promises: PromiseApi) {
  const output: string[] = [];
  const transform = new stream.Transform({
    transform(chunk: Buffer, _encoding, callback) {
      callback(null, chunk.toString().toUpperCase());
    },
  });
  const destination = new stream.Writable({
    write(chunk: Buffer, _encoding, callback) {
      output.push(chunk.toString());
      callback();
    },
  });
  return promises
    .pipeline(stream.Readable.from(['hello', ' world']), transform, destination)
    .then(() => output.join(''));
}

async function pipelineWithoutEndingDestination(stream: StreamApi, promises: PromiseApi) {
  const destination = new stream.Writable({
    write(_chunk, _encoding, callback) {
      callback();
    },
  });
  await promises.pipeline(stream.Readable.from(['data']), destination, { end: false });
  const remainsOpen = !destination.writableEnded && !destination.destroyed;
  destination.end();
  return remainsOpen;
}

async function finishedCleanup(stream: StreamApi, promises: PromiseApi) {
  const source = new stream.Readable({
    read() {
      this.push(null);
    },
  });
  const before = ['end', 'finish', 'error', 'close'].map(event => source.listenerCount(event));
  source.resume();
  await promises.finished(source, { cleanup: true });
  const after = ['end', 'finish', 'error', 'close'].map(event => source.listenerCount(event));
  return { before, after };
}

async function finishedAbort(stream: StreamApi, promises: PromiseApi) {
  const controller = new AbortController();
  const source = new stream.Readable({ read() {} });
  const pending = promises.finished(source, { signal: controller.signal }).then(
    () => 'resolved',
    error => (error.name === 'AbortError' ? 'aborted' : 'rejected')
  );
  controller.abort();
  const outcome = await pending;
  const remainsOpen = !source.destroyed;
  source.destroy();
  return { outcome, remainsOpen };
}

async function prematureClose(stream: StreamApi, promises: PromiseApi) {
  const source = new stream.Readable({ read() {} });
  const pending = promises.finished(source).then(
    () => 'resolved',
    error => error.code ?? error.name
  );
  source.destroy();
  return pending;
}

describe('stream/promises upstream compatibility', () => {
  it('runs the upstream JavaScript port for pipeline, matching native stream behavior', async () => {
    expect(await collectPipeline(upstreamStream, upstreamPromises)).toBe(
      await collectPipeline(nativeStream, nativePromises)
    );
  });

  it('returns the final async generator value from pipeline', async () => {
    const run = (promises: PromiseApi) =>
      promises.pipeline(
        async function* source() {
          yield 'first';
          yield 'second';
        },
        async function destination(source) {
          let combined = '';
          for await (const chunk of source) combined += chunk;
          return `${combined}:done`;
        }
      );
    expect(await run(upstreamPromises)).toBe(await run(nativePromises));
    expect(await run(upstreamPromises)).toBe('firstsecond:done');
  });

  it('preserves pipeline error identity and destroys connected streams', async () => {
    const sourceError = new Error('source failed');
    const run = async (stream: StreamApi, promises: PromiseApi) => {
      const source = new stream.Readable({ read() {} });
      const destination = new stream.Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });
      const pending = promises.pipeline(source, destination).then(
        () => false,
        error => error === sourceError
      );
      source.destroy(sourceError);
      const sameError = await pending;
      return { sameError, destinationDestroyed: destination.destroyed };
    };
    expect(await run(upstreamStream, upstreamPromises)).toEqual(
      await run(nativeStream, nativePromises)
    );
    expect(await run(upstreamStream, upstreamPromises)).toEqual({
      sameError: true,
      destinationDestroyed: true,
    });
  });

  it('aborts pipeline and destroys connected streams', async () => {
    const run = async (stream: StreamApi, promises: PromiseApi) => {
      const controller = new AbortController();
      const destination = new stream.Writable({
        write(_chunk, _encoding, callback) {
          controller.abort();
          callback();
        },
      });
      const source = stream.Readable.from(['data']);
      const outcome = await promises
        .pipeline(source, destination, { signal: controller.signal })
        .then(
          () => 'resolved',
          error => (error.name === 'AbortError' ? 'aborted' : 'rejected')
        );
      return {
        outcome,
        sourceDestroyed: source.destroyed,
        destinationDestroyed: destination.destroyed,
      };
    };
    expect(await run(upstreamStream, upstreamPromises)).toEqual(
      await run(nativeStream, nativePromises)
    );
    expect(await run(upstreamStream, upstreamPromises)).toEqual({
      outcome: 'aborted',
      sourceDestroyed: true,
      destinationDestroyed: true,
    });
  });

  it('keeps a destination open when pipeline end is false', async () => {
    expect(await pipelineWithoutEndingDestination(upstreamStream, upstreamPromises)).toBe(
      await pipelineWithoutEndingDestination(nativeStream, nativePromises)
    );
    expect(await pipelineWithoutEndingDestination(upstreamStream, upstreamPromises)).toBe(true);
  });

  it('cleans finished listeners when requested', async () => {
    expect(await finishedCleanup(upstreamStream, upstreamPromises)).toEqual(
      await finishedCleanup(nativeStream, nativePromises)
    );
    expect((await finishedCleanup(upstreamStream, upstreamPromises)).after).toEqual([0, 0, 0, 0]);
  });

  it('rejects finished on abort without destroying its stream', async () => {
    expect(await finishedAbort(upstreamStream, upstreamPromises)).toEqual(
      await finishedAbort(nativeStream, nativePromises)
    );
    expect(await finishedAbort(upstreamStream, upstreamPromises)).toEqual({
      outcome: 'aborted',
      remainsOpen: true,
    });
  });

  it('rejects finished when a stream closes before ending', async () => {
    expect(await prematureClose(upstreamStream, upstreamPromises)).toBe(
      await prematureClose(nativeStream, nativePromises)
    );
    expect(await prematureClose(upstreamStream, upstreamPromises)).toBe(
      'ERR_STREAM_PREMATURE_CLOSE'
    );
  });

  it('resolves stream/promises aliases to one object and runs pipeline in the runtime', async () => {
    const rootPath = '/workspace/stream-promises';
    const output: string[] = [];
    const options: RuntimeExecutionOptions = {
      rootPath,
      filePath: `${rootPath}/entry.js`,
      debugConsole: {
        log: (...values) => output.push(values.join(' ')),
        error() {},
        warn() {},
        clear() {},
      },
    };
    const result = await executeIsolatedNodeRuntime(options, [
      {
        path: options.filePath,
        data: new TextEncoder().encode(
          [
            "const stream = require('node:stream');",
            "const promises = require('stream/promises');",
            "if (promises !== require('node:stream/promises')) throw new Error('promise alias differs');",
            "if (promises !== stream.promises) throw new Error('stream.promises differs');",
            'const chunks = [];',
            "promises.pipeline(stream.Readable.from(['alias ', 'works']), new stream.Writable({ write(chunk, _, done) { chunks.push(chunk.toString()); done(); } })).then(() => console.log(chunks.join('')));",
          ].join('\n')
        ),
      },
    ]);

    expect(result.exitCode).toBe(0);
    expect(output).toEqual(['alias works']);
  });
});
