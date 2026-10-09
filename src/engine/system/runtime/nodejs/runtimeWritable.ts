import { Writable } from 'node:stream';

export function createRuntimeWritable(
  write: (chunk: Uint8Array, encoding: BufferEncoding) => void
): Writable {
  return new Writable({
    write(chunk, encoding, callback) {
      try {
        write(chunk, encoding);
        callback();
      } catch (error) {
        if (error instanceof Error) callback(error);
        else callback(new Error(String(error)));
      }
    },
  });
}
