import { Buffer } from 'buffer';
import pako from 'pako';
import tarStream from 'tar-stream';
import { describe, expect, it } from 'vitest';
import {
  type TarEntry,
  TarExtractor,
} from '@/engine/system/npm/install/tarExtractor';

interface ArchiveFile {
  name: string;
  content: Uint8Array;
  type?: 'file' | 'directory' | 'symlink';
  linkname?: string;
}

async function archive(files: ArchiveFile[]): Promise<Uint8Array<ArrayBuffer>> {
  const pack = tarStream.pack();
  const chunks: Buffer[] = [];
  const finished = new Promise<void>((resolve, reject) => {
    pack.on('data', (chunk: Buffer) => chunks.push(chunk));
    pack.on('end', resolve);
    pack.on('error', reject);
  });
  for (const file of files) {
    if (file.type === 'symlink') {
      if (!file.linkname) throw new Error('Symlink archive fixture requires linkname.');
      pack.entry(
        { name: file.name, type: 'symlink', linkname: file.linkname },
        Buffer.from(file.content)
      );
    } else {
      pack.entry({ name: file.name, type: file.type ?? 'file' }, Buffer.from(file.content));
    }
  }
  pack.finalize();
  await finished;
  return pako.gzip(Buffer.concat(chunks)).slice();
}

function decompress(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 3));
      controller.enqueue(bytes.subarray(3));
      controller.close();
    },
  }).pipeThrough(new DecompressionStream('gzip'));
}

describe('streamed npm tar extraction', () => {
  it('preserves binary bytes and undecoded module bytes', async () => {
    const bytes = Uint8Array.from([0, 255, 128]);
    const compressed = await archive([
      { name: 'package/binary.txt', content: bytes },
      { name: 'package/invalid.mjs', content: bytes },
    ]);
    const files = new Map<string, Uint8Array>();
    await new TarExtractor().extractFromStream('/package', decompress(compressed), async entry => {
      if (entry.type === 'file') files.set(entry.path, entry.content);
    });
    expect(files.get('/package/binary.txt')).toEqual(bytes);
    expect(files.get('/package/invalid.mjs')).toEqual(bytes);
  });

  it('awaits each file consumer before advancing the archive', async () => {
    const compressed = await archive([
      { name: 'package/first.js', content: new Uint8Array(64 * 1024) },
      { name: 'package/second.js', content: new Uint8Array(64 * 1024) },
    ]);
    let release: () => void = () => {};
    const blocked = new Promise<void>(resolve => {
      release = resolve;
    });
    let entered: () => void = () => {};
    const firstEntered = new Promise<void>(resolve => {
      entered = resolve;
    });
    const paths: string[] = [];
    const result = new TarExtractor().extractFromStream(
      '/package',
      decompress(compressed),
      async entry => {
        paths.push(entry.path);
        if (paths.length === 1) {
          entered();
          await blocked;
        }
      }
    );
    await firstEntered;
    expect(paths).toEqual(['/package/first.js']);
    release();
    await result;
    expect(paths).toEqual(['/package/first.js', '/package/second.js']);
  });

  it('skips archive paths outside the package', async () => {
    const compressed = await archive([
      { name: 'package/../../escape.js', content: new Uint8Array([1]) },
      { name: '/absolute.js', content: new Uint8Array([2]) },
      { name: 'package/lib/valid.js', content: new Uint8Array([3]) },
    ]);
    const paths: string[] = [];
    await new TarExtractor().extractFromStream('/package', decompress(compressed), async entry => {
      paths.push(entry.path);
    });
    expect(paths).toEqual(['/package/lib/valid.js']);
  });

  it('rejects consumer failures and releases the stream reader', async () => {
    const compressed = await archive([
      { name: 'package/first.js', content: new Uint8Array(128 * 1024) },
      { name: 'package/second.js', content: new Uint8Array(128 * 1024) },
    ]);
    const stream = decompress(compressed);
    const paths: string[] = [];
    const result = new TarExtractor().extractFromStream('/package', stream, async entry => {
      paths.push(entry.path);
      throw new Error('write failed');
    });
    await expect(result).rejects.toThrow('write failed');
    expect(paths).toEqual(['/package/first.js']);
    expect(stream.locked).toBe(false);
  });

  it('rejects invalid gzip input and releases the stream reader', async () => {
    const stream = decompress(new Uint8Array([1, 2, 3]));
    await expect(
      new TarExtractor().extractFromStream('/package', stream, async () => {})
    ).rejects.toThrow();
    expect(stream.locked).toBe(false);
  });

  it('preserves empty directories and the last entry for duplicate paths', async () => {
    const compressed = await archive([
      { name: 'package/empty/', type: 'directory', content: new Uint8Array() },
      { name: 'package/value.js', content: new Uint8Array([1]) },
      { name: 'package/value.js', content: new Uint8Array([2]) },
    ]);
    const files = new Map<string, Uint8Array>();
    const directories: string[] = [];
    await new TarExtractor().extractFromStream('/package', decompress(compressed), async entry => {
      if (entry.type === 'directory') directories.push(entry.path);
      else files.set(entry.path, entry.content);
    });
    expect(directories).toEqual(['/package/empty']);
    expect(files.get('/package/value.js')).toEqual(new Uint8Array([2]));
  });

  it('strips one archive root component and preserves relative symlink targets', async () => {
    const compressed = await archive([
      { name: 'ejs-archive/lib/ejs.js', content: new Uint8Array([7]) },
      {
        name: 'ejs-archive/bin/ejs',
        type: 'symlink',
        linkname: '../lib/ejs.js',
        content: new Uint8Array(),
      },
    ]);
    const entries: TarEntry[] = [];
    await new TarExtractor().extractFromStream('/package', decompress(compressed), async entry => {
      entries.push(entry);
    });
    expect(entries).toEqual([
      { type: 'file', path: '/package/lib/ejs.js', content: new Uint8Array([7]) },
      { type: 'symlink', path: '/package/bin/ejs', target: '../lib/ejs.js' },
    ]);
  });
});
