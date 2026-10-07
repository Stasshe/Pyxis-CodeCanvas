import { Buffer } from 'buffer';
import pako from 'pako';
import tarStream from 'tar-stream';
import { describe, expect, it } from 'vitest';
import { TarExtractor } from '@/engine/cmd/global/npmOperations/install/tarExtractor';

async function archive(name: string, content: Uint8Array): Promise<Uint8Array<ArrayBuffer>> {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));
    pack.on('end', resolve);
    pack.on('error', reject);
  });
  pack.entry({ name: `package/${name}`, type: 'file' }, Buffer.from(content));
  pack.finalize();
  await finished;
  return pako.gzip(Buffer.concat(chunks)).slice();
}

function stream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 3));
      controller.enqueue(bytes.subarray(3));
      controller.close();
    },
  });
}

describe('npm tar extraction bytes', () => {
  it('preserves binary bytes with a misleading extension in buffer and streamed extraction', async () => {
    const bytes = Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4);
    const compressed = await archive('binary.txt', bytes);
    const extractor = new TarExtractor();
    const buffered = await extractor.extractFromBuffer('/package', compressed.buffer);
    const streamed = await extractor.extractFromStream(
      '/package',
      extractor.createPakoDecompressedStream(stream(compressed))
    );
    expect(buffered.get('binary.txt')?.content).toEqual(Uint8Array.from(bytes));
    expect(streamed.get('binary.txt')?.content).toEqual(Uint8Array.from(bytes));
  });

  it('rejects invalid UTF-8 in compile input instead of replacing bytes', async () => {
    const compressed = await archive('invalid.mjs', new Uint8Array([255, 128]));
    const extractor = new TarExtractor();
    await expect(extractor.extractFromBuffer('/package', compressed.buffer)).rejects.toThrow();
    await expect(
      extractor.extractFromStream(
        '/package',
        extractor.createPakoDecompressedStream(stream(compressed))
      )
    ).rejects.toThrow();
  });
});
