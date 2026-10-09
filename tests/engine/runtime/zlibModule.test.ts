import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { constants } from '@/engine/runtime/nodejs/modules/constantsModule';
import { createZlibModule } from '@/engine/runtime/nodejs/modules/zlibModule';

async function collect(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

describe('Node zlib builtin', () => {
  it('compresses and inflates gzip bytes with one-shot APIs', () => {
    const zlib = createZlibModule();
    const source = Buffer.from('express middleware payload');
    const compressed = zlib.gzipSync(source);

    expect(Buffer.from(compressed).subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));
    expect(Buffer.from(zlib.gunzipSync(compressed))).toEqual(source);
    expect(Buffer.from(zlib.unzipSync(compressed))).toEqual(source);
    expect(() => zlib.inflateSync(compressed)).toThrow();
    expect(() => zlib.gunzipSync(zlib.deflateSync(source))).toThrow();
  });

  it('auto-detects gzip and deflate formats in unzip APIs', async () => {
    const zlib = createZlibModule();
    const source = Buffer.from('auto-detected payload');
    const gzip = zlib.gzipSync(source);
    const deflate = zlib.deflateSync(source);
    expect(zlib.unzipSync(gzip)).toEqual(source);
    expect(zlib.unzipSync(deflate)).toEqual(source);
    const stream = zlib.createUnzip();
    expect(await collect(Readable.from([gzip]).pipe(stream))).toEqual(source);
  });

  it('exposes malformed compressed input as a coded Error', () => {
    const zlib = createZlibModule();
    try {
      zlib.unzipSync(Buffer.from('invalid compressed data'));
      throw new Error('Expected unzipSync to fail.');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect(error).toMatchObject({ code: 'Z_DATA_ERROR', errno: -3 });
      expect((error as Error).message).toBeTruthy();
    }
  });

  it('encodes string input as UTF-8 before compression', () => {
    const zlib = createZlibModule();
    const source = '猫 payload';
    const compressed = zlib.gzipSync(source);
    const pakoOnlyOptions = { to: 'string' };

    expect(Buffer.from(zlib.gunzipSync(compressed))).toEqual(Buffer.from(source));
    expect(Buffer.from(zlib.gunzipSync(compressed, pakoOnlyOptions))).toEqual(Buffer.from(source));
  });

  it('uses Node callback timing and reports invalid compressed data', async () => {
    const zlib = createZlibModule();
    const source = Buffer.from('callback compression payload');
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gzip(source, (error, result) => {
        if (error) reject(error);
        else if (result) resolve(result);
        else reject(new Error('gzip returned no result.'));
      });
    });

    expect(Buffer.from(zlib.gunzipSync(compressed))).toEqual(source);
    await new Promise<void>(resolve => {
      zlib.gunzip(Buffer.from('invalid gzip'), error => {
        expect(error).toBeInstanceOf(Error);
        resolve();
      });
    });
  });

  it('supports gzip as a streaming transform', async () => {
    const zlib = createZlibModule();
    const source = Buffer.from('streamed response body');
    const compressed = await collect(Readable.from([source]).pipe(zlib.createGzip()));
    const inflated = await collect(Readable.from([compressed]).pipe(zlib.createGunzip()));

    expect(inflated).toEqual(source);
  });

  it('flushes a streaming response before the gzip stream ends', async () => {
    const zlib = createZlibModule();
    const firstChunk = Buffer.from('first response chunk');
    const secondChunk = Buffer.from('second response chunk');
    const stream = zlib.createGzip();
    const compressedPromise = collect(stream);

    stream.write(firstChunk);
    await new Promise<void>((resolve, reject) => {
      stream.flush(error => {
        if (error) reject(error);
        else resolve();
      });
    });
    stream.end(secondChunk);

    expect(Buffer.from(zlib.gunzipSync(await compressedPromise))).toEqual(
      Buffer.concat([firstChunk, secondChunk])
    );
  });

  it('rejects truncated streaming input', async () => {
    const zlib = createZlibModule();
    const compressed = zlib.gzipSync(Buffer.from('truncated stream payload'));
    const truncated = compressed.subarray(0, compressed.length - 4);

    await expect(collect(Readable.from([truncated]).pipe(zlib.createGunzip()))).rejects.toThrow();
  });

  it('shares filesystem access constants through node:constants', () => {
    expect(constants.F_OK).toBe(0);
    expect(constants.R_OK).toBe(4);
    expect(Object.isFrozen(constants)).toBe(true);
  });
});
