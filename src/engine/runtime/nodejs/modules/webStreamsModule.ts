/** Captures native WHATWG stream constructors before guest code can modify globals. */
const nativeWebStreams = {
  ReadableStream: globalThis.ReadableStream,
  ReadableStreamDefaultReader: globalThis.ReadableStreamDefaultReader,
  ReadableStreamBYOBReader: globalThis.ReadableStreamBYOBReader,
  ReadableStreamBYOBRequest: globalThis.ReadableStreamBYOBRequest,
  ReadableByteStreamController: globalThis.ReadableByteStreamController,
  ReadableStreamDefaultController: globalThis.ReadableStreamDefaultController,
  TransformStream: globalThis.TransformStream,
  TransformStreamDefaultController: globalThis.TransformStreamDefaultController,
  WritableStream: globalThis.WritableStream,
  WritableStreamDefaultWriter: globalThis.WritableStreamDefaultWriter,
  WritableStreamDefaultController: globalThis.WritableStreamDefaultController,
  ByteLengthQueuingStrategy: globalThis.ByteLengthQueuingStrategy,
  CountQueuingStrategy: globalThis.CountQueuingStrategy,
  TextEncoderStream: globalThis.TextEncoderStream,
  TextDecoderStream: globalThis.TextDecoderStream,
  CompressionStream: globalThis.CompressionStream,
  DecompressionStream: globalThis.DecompressionStream,
};

export type WebStreamsModule = typeof nativeWebStreams;

export function createWebStreamsModule(): WebStreamsModule {
  return { ...nativeWebStreams };
}
