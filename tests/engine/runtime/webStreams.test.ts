import * as nativeWeb from 'node:stream/web';
import { describe, expect, it } from 'vitest';
import type { RuntimeExecutionOptions } from '@/engine/runtime/core/RuntimeProvider';
import { createWebStreamsModule } from '@/engine/runtime/nodejs/modules/webStreamsModule';
import { executeIsolatedNodeRuntime } from '../../_helpers/isolatedNodeRuntime';

type WebStreamsApi = typeof nativeWeb;
const moduleWeb = createWebStreamsModule();

async function transformText(api: WebStreamsApi, text: string): Promise<string> {
  const output: string[] = [];
  const transform = new api.TransformStream<string, string>({
    transform(chunk, controller) {
      controller.enqueue(chunk.toUpperCase());
    },
  });
  const destination = new api.WritableStream<string>({
    write(chunk) {
      output.push(chunk);
    },
  });
  const source = new api.ReadableStream<string>({
    start(controller) {
      controller.enqueue(text);
      controller.close();
    },
  });
  await source.pipeThrough(transform).pipeTo(destination);
  return output.join('');
}

async function readBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    chunks.push(result.value);
  }
  const output = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function byobRead(api: WebStreamsApi) {
  const source = new api.ReadableStream<Uint8Array>({
    type: 'bytes',
    pull(controller) {
      const request = controller.byobRequest;
      const view = request?.view;
      if (!(view instanceof Uint8Array)) throw new Error('Expected a Uint8Array BYOB view.');
      view.set([11, 22, 33]);
      request.respond(3);
      controller.close();
    },
  });
  const reader = source.getReader({ mode: 'byob' });
  const first = await reader.read(new Uint8Array(8));
  const second = await reader.read(new Uint8Array(8));
  reader.releaseLock();
  return {
    bytes: Array.from(first.value ?? []),
    firstDone: first.done,
    secondDone: second.done,
    canReadAgain: source.locked === false,
  };
}

async function pipeAbort(api: WebStreamsApi) {
  const reason = new Error('cancel pipeline');
  const controller = new AbortController();
  let cancellation: Error | undefined;
  let abortReason: Error | undefined;
  const source = new api.ReadableStream<string>({
    cancel(value) {
      if (value instanceof Error) cancellation = value;
    },
  });
  const destination = new api.WritableStream<string>({
    abort(value) {
      if (value instanceof Error) abortReason = value;
    },
  });
  const pending = source.pipeTo(destination, { signal: controller.signal }).then(
    () => 'resolved',
    () => 'rejected'
  );
  controller.abort(reason);
  return { outcome: await pending, sameReason: cancellation === reason && abortReason === reason };
}

async function textPipeline(api: WebStreamsApi, text: string) {
  const source = new api.ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const decoder = new api.TextDecoderStream();
  const encoder = new api.TextEncoderStream();
  return new TextDecoder().decode(
    await readBytes(source.pipeThrough(decoder).pipeThrough(encoder))
  );
}

async function compressionRoundTrip(api: WebStreamsApi, format: CompressionFormat, text: string) {
  const source = new api.ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  const compressed = await readBytes(source.pipeThrough(new api.CompressionStream(format)));
  const restored = await readBytes(
    new api.ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(compressed);
        controller.close();
      },
    }).pipeThrough(new api.DecompressionStream(format))
  );
  return new TextDecoder().decode(restored);
}

async function transformErrorIdentity(api: WebStreamsApi): Promise<boolean> {
  const failure = new Error('transform failed');
  const source = new api.ReadableStream<string>({
    start(controller) {
      controller.enqueue('chunk');
      controller.close();
    },
  });
  const reader = source
    .pipeThrough(
      new api.TransformStream<string, string>({
        transform() {
          throw failure;
        },
      })
    )
    .getReader();
  const sameError = await reader.read().then(
    () => false,
    error => error === failure
  );
  reader.releaseLock();
  return sameError;
}

describe('stream/web compatibility', () => {
  it('isolates module objects while preserving their native constructors', () => {
    const first = createWebStreamsModule();
    const second = createWebStreamsModule();

    expect(first).not.toBe(second);
    expect(first.ReadableStream).toBe(nativeWeb.ReadableStream);
    expect(second.ReadableStream).toBe(nativeWeb.ReadableStream);
    Object.defineProperty(first, 'ReadableStream', { value: class {} });
    expect(second.ReadableStream).toBe(nativeWeb.ReadableStream);
  });

  it('exposes native stream constructors and runs web stream lifecycles in the worker', async () => {
    const rootPath = '/workspace/web-streams';
    const output: string[] = [];
    const filePath = `${rootPath}/entry.mjs`;
    const text = 'Pyxis streams 🌱';
    const oracle = {
      transformed: await transformText(nativeWeb, 'streams'),
      transformErrorIdentity: await transformErrorIdentity(nativeWeb),
      byob: await byobRead(nativeWeb),
      abort: await pipeAbort(nativeWeb),
      text: await textPipeline(nativeWeb, text),
      gzip: await compressionRoundTrip(nativeWeb, 'gzip', text),
      deflate: await compressionRoundTrip(nativeWeb, 'deflate', text),
    };
    const options: RuntimeExecutionOptions = {
      rootPath,
      filePath,
      debugConsole: {
        log: (...values) => output.push(values.join(' ')),
        error: (...values) => output.push(values.join(' ')),
        warn() {},
        clear() {},
      },
    };
    const result = await executeIsolatedNodeRuntime(options, [
      {
        path: filePath,
        data: new TextEncoder().encode(
          [
            "import web from 'node:stream/web';",
            "import bareWeb from 'stream/web';",
            "if (web !== bareWeb) throw new Error('stream/web aliases differ');",
            'const names = [',
            "  'ReadableStream', 'ReadableStreamDefaultReader', 'ReadableStreamBYOBReader',",
            "  'ReadableStreamBYOBRequest', 'ReadableByteStreamController', 'ReadableStreamDefaultController',",
            "  'TransformStream', 'TransformStreamDefaultController', 'WritableStream',",
            "  'WritableStreamDefaultWriter', 'WritableStreamDefaultController', 'ByteLengthQueuingStrategy',",
            "  'CountQueuingStrategy', 'TextEncoderStream', 'TextDecoderStream', 'CompressionStream', 'DecompressionStream',",
            '];',
            'for (const name of names) if (web[name] !== globalThis[name]) throw new Error(`${name} identity differs`);',
            '  async function collect(stream) { const reader = stream.getReader(); const chunks = []; while (true) { const result = await reader.read(); if (result.done) break; chunks.push(result.value); } const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0); const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; } return bytes; }',
            '  async function compressionRoundTrip(format) { const source = new web.ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("Pyxis streams 🌱")); controller.close(); } }); const compressed = await collect(source.pipeThrough(new web.CompressionStream(format))); const restored = new web.ReadableStream({ start(controller) { controller.enqueue(compressed); controller.close(); } }).pipeThrough(new web.DecompressionStream(format)); return new TextDecoder().decode(await collect(restored)); }',
            '  const transformedOutput = [];',
            "  const source = new web.ReadableStream({ start(controller) { controller.enqueue('streams'); controller.close(); } });",
            '  await source.pipeThrough(new web.TransformStream({ transform(chunk, controller) { controller.enqueue(chunk.toUpperCase()); } })).pipeTo(new web.WritableStream({ write(chunk) { transformedOutput.push(chunk); } }));',
            '  const transformError = new Error("transform failed");',
            '  const failedSource = new web.ReadableStream({ start(controller) { controller.enqueue("chunk"); controller.close(); } });',
            '  const failedReader = failedSource.pipeThrough(new web.TransformStream({ transform() { throw transformError; } })).getReader();',
            '  let transformErrorIdentity = false;',
            '  try { await failedReader.read(); } catch (error) { transformErrorIdentity = error === transformError; }',
            '  failedReader.releaseLock();',
            '  const byteSource = new web.ReadableStream({ type: "bytes", pull(controller) { const request = controller.byobRequest; request.view.set([11, 22, 33]); request.respond(3); controller.close(); } });',
            '  const byteReader = byteSource.getReader({ mode: "byob" });',
            '  const first = await byteReader.read(new Uint8Array(8));',
            '  const second = await byteReader.read(new Uint8Array(8));',
            '  byteReader.releaseLock();',
            '  const abortReason = new Error("cancel pipeline");',
            '  const abortController = new AbortController();',
            '  let cancelReason;',
            '  let destinationReason;',
            '  const abortSource = new web.ReadableStream({ cancel(reason) { cancelReason = reason; } });',
            '  const abortDestination = new web.WritableStream({ abort(reason) { destinationReason = reason; } });',
            '  const aborted = abortSource.pipeTo(abortDestination, { signal: abortController.signal }).then(() => false, () => true);',
            '  abortController.abort(abortReason);',
            '  const abortedAsExpected = await aborted;',
            '  const textSource = new web.ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode("Pyxis streams 🌱")); controller.close(); } });',
            '  const encoded = textSource.pipeThrough(new web.TextDecoderStream()).pipeThrough(new web.TextEncoderStream());',
            '  const encodedText = new TextDecoder().decode(await collect(encoded));',
            '  const gzip = await compressionRoundTrip("gzip");',
            '  const deflate = await compressionRoundTrip("deflate");',
            '  console.log(JSON.stringify({ transformed: transformedOutput.join(""), transformErrorIdentity, byob: { bytes: Array.from(first.value), firstDone: first.done, secondDone: second.done, canReadAgain: !byteSource.locked }, abort: { outcome: abortedAsExpected ? "rejected" : "resolved", sameReason: cancelReason === abortReason && destinationReason === abortReason }, text: encodedText, gzip, deflate }));',
          ].join('\n')
        ),
      },
    ]);

    expect(result.exitCode).toBe(0);
    expect(output).toEqual([JSON.stringify(oracle)]);
  });

  it('preserves transform error identity for a reader', async () => {
    expect(await transformErrorIdentity(moduleWeb)).toBe(await transformErrorIdentity(nativeWeb));
    expect(await transformErrorIdentity(moduleWeb)).toBe(true);
  });

  it('fills a BYOB view, closes cleanly, and releases its reader lock', async () => {
    expect(await byobRead(moduleWeb)).toEqual(await byobRead(nativeWeb));
    await expect(byobRead(moduleWeb)).resolves.toEqual({
      bytes: [11, 22, 33],
      firstDone: false,
      secondDone: true,
      canReadAgain: true,
    });
  });

  it('passes the abort reason to source cancellation and destination abort', async () => {
    expect(await pipeAbort(moduleWeb)).toEqual(await pipeAbort(nativeWeb));
    await expect(pipeAbort(moduleWeb)).resolves.toEqual({ outcome: 'rejected', sameReason: true });
  });

  it('round trips encoded text through TextDecoderStream and TextEncoderStream', async () => {
    expect(await textPipeline(moduleWeb, 'Pyxis streams 🌱')).toBe(
      await textPipeline(nativeWeb, 'Pyxis streams 🌱')
    );
    await expect(textPipeline(moduleWeb, 'Pyxis streams 🌱')).resolves.toBe('Pyxis streams 🌱');
  });

  it.each(['gzip', 'deflate'] as const)(
    'round trips %s compression with the Node 24 oracle',
    async format => {
      await expect(
        compressionRoundTrip(moduleWeb, format, 'web streams survive compression')
      ).resolves.toBe('web streams survive compression');
      expect(await compressionRoundTrip(moduleWeb, format, 'web streams survive compression')).toBe(
        await compressionRoundTrip(nativeWeb, format, 'web streams survive compression')
      );
    }
  );
});
