import stream from 'node:stream';
import { describe, expect, it } from 'vitest';
import { createRuntimeStreamModule } from '@/engine/runtime/nodejs/modules/readableWebAdapters';

describe('Node Readable and WHATWG stream adapters', () => {
  it('reads generic object chunks from a Web Stream in object mode', async () => {
    const stream = createRuntimeStreamModule();
    const source = new ReadableStream({
      start(controller) {
        controller.enqueue({ value: 1 });
        controller.enqueue({ value: 2 });
        controller.close();
      },
    });
    const readable = stream.Readable.fromWeb(source, { objectMode: true });
    const chunks: { value: number }[] = [];
    for await (const chunk of readable) chunks.push(chunk);

    expect(chunks).toEqual([{ value: 1 }, { value: 2 }]);
    expect(source.locked).toBe(true);
  });

  it('preserves Web Stream errors and aborts the Web reader when destroyed', async () => {
    const stream = createRuntimeStreamModule();
    const failure = new Error('source failed');
    const failedSource = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure);
      },
    });
    const failedReadable = stream.Readable.fromWeb(failedSource);
    const sameError = new Promise<boolean>(resolve => {
      failedReadable.once('error', error => resolve(error === failure));
    });
    failedReadable.resume();

    expect(await sameError).toBe(true);
    expect(failedSource.locked).toBe(true);

    let canceledWith: Error | undefined;
    const cancelSource = new ReadableStream<Uint8Array>({
      cancel(reason) {
        if (reason instanceof Error) canceledWith = reason;
      },
    });
    const readable = stream.Readable.fromWeb(cancelSource);
    const reason = new Error('stop reading');
    const closed = new Promise<void>(resolve => readable.once('close', resolve));
    readable.once('error', () => {});
    readable.destroy(reason);
    await closed;

    expect(canceledWith).toBe(reason);
    expect(cancelSource.locked).toBe(true);
  });

  it('forwards AbortSignal cancellation and validates options before locking input', async () => {
    const stream = createRuntimeStreamModule();
    const invalidSource = new ReadableStream<Uint8Array>();
    expect(() => stream.Readable.fromWeb(invalidSource, { highWaterMark: -1 })).toThrow();
    expect(invalidSource.locked).toBe(false);

    let canceledWith: Error | undefined;
    const source = new ReadableStream<Uint8Array>({
      cancel(reason) {
        if (reason instanceof Error) canceledWith = reason;
      },
    });
    const controller = new AbortController();
    const readable = stream.Readable.fromWeb(source, { signal: controller.signal });
    const failure = new Promise<Error>(resolve => readable.once('error', resolve));
    readable.resume();
    controller.abort();
    const error = await failure;

    expect(error.name).toBe('AbortError');
    expect(canceledWith).toBe(error);
    expect(source.locked).toBe(true);
  });

  it('preserves backpressure, object chunks, and cancellation in the Web adapter', async () => {
    const stream = createRuntimeStreamModule();
    let reads = 0;
    const source = new stream.Readable({
      objectMode: true,
      highWaterMark: 1,
      read() {
        reads += 1;
        if (reads > 3) {
          this.push(null);
          return;
        }
        this.push({ value: reads });
      },
    });
    const web = stream.Readable.toWeb(source);
    const reader = web.getReader();
    const values: { value: number }[] = [];
    const firstResult = await reader.read();
    if (firstResult.done) throw new Error('Expected the first object chunk.');
    values.push(firstResult.value);
    expect(reads).toBeLessThanOrEqual(3);
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      values.push(result.value);
    }
    expect(values).toEqual([{ value: 1 }, { value: 2 }, { value: 3 }]);

    const ended = stream.Readable.from(['done']);
    for await (const _chunk of ended) {
      // Consume the source before adapting it.
    }
    const endedReader = stream.Readable.toWeb(ended).getReader();
    expect(await endedReader.read()).toEqual({ value: undefined, done: true });

    const destroyed = new stream.Readable({ read() {} });
    destroyed.destroy();
    await new Promise<void>(resolve => destroyed.once('close', resolve));
    const destroyedReader = stream.Readable.toWeb(destroyed).getReader();
    expect(await destroyedReader.read()).toEqual({ value: undefined, done: true });

    const canceledSource = new stream.Readable({ read() {} });
    const canceledWeb = stream.Readable.toWeb(canceledSource);
    await canceledWeb.cancel(new Error('stop writing'));
    expect(canceledSource.destroyed).toBe(true);
  });

  it('rejects a Web reader when a Node Readable closes before ending', async () => {
    const stream = createRuntimeStreamModule();
    const source = new stream.Readable({ read() {} });
    const reader = stream.Readable.toWeb(source).getReader();
    const pending = reader.read();
    source.destroy();

    await expect(pending).rejects.toMatchObject({ code: 'ERR_STREAM_PREMATURE_CLOSE' });
  });

  it('preserves errors from an already-failed Node stream and strategy callbacks', async () => {
    const stream = createRuntimeStreamModule();
    const failure = new Error('node stream failed');
    const failedSource = new stream.Readable({ read() {} });
    failedSource.once('error', () => {});
    failedSource.destroy(failure);
    await new Promise<void>(resolve => failedSource.once('close', resolve));
    const failedReader = stream.Readable.toWeb(failedSource).getReader();
    await expect(failedReader.read()).rejects.toBe(failure);

    const strategyError = new Error('strategy failed');
    const source = stream.Readable.from(['chunk']);
    const web = stream.Readable.toWeb<string>(source, {
      strategy: {
        highWaterMark: 1,
        size() {
          throw strategyError;
        },
      },
    });
    await new Promise<void>(resolve => setImmediate(resolve));
    await expect(web.getReader().read()).rejects.toBe(strategyError);
  });

  it('creates isolated stream facades without changing the shared constructor', () => {
    const first = createRuntimeStreamModule();
    const second = createRuntimeStreamModule();
    const source = new first.Readable({ read() {} });

    expect(first).not.toBe(second);
    expect(source).toBeInstanceOf(first.Readable);
    expect(source).toBeInstanceOf(second.Readable);
    expect(first.Stream).toBe(first);
    expect(first.Readable).not.toBe(stream.Readable);
    expect(first.Readable.fromWeb).not.toBe(stream.Readable.fromWeb);
  });
});
