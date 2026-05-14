import pako from 'pako';
import tarStream from 'tar-stream';

import type { ExtractedFileMap } from './types';

function isBinaryBuffer(buf: Uint8Array): boolean {
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0) return true;
  }
  const len = Math.min(buf.length, 512);
  let nonPrintable = 0;
  for (let i = 0; i < len; i++) {
    const c = buf[i];
    if (c === 9 || c === 10 || c === 13) continue;
    if (c < 32 || c > 126) nonPrintable++;
  }
  return nonPrintable / Math.max(1, len) > 0.3;
}

function uint8ArrayToBase64(buf: Uint8Array): string {
  if (typeof btoa !== 'undefined') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < buf.length; i += chunkSize) {
      binary += String.fromCharCode.apply(null, Array.from(buf.subarray(i, i + chunkSize)));
    }
    return btoa(binary);
  }
  if (typeof Buffer !== 'undefined') return Buffer.from(buf).toString('base64');
  let result = '';
  for (let i = 0; i < buf.length; i++) result += String.fromCharCode(buf[i]);
  return typeof btoa !== 'undefined' ? btoa(result) : result;
}

export class TarExtractor {
  private textDecoder = new TextDecoder('utf-8', { fatal: false });

  private encodeContent(buf: Uint8Array): string {
    return isBinaryBuffer(buf)
      ? `base64:${uint8ArrayToBase64(buf)}`
      : this.textDecoder.decode(buf);
  }

  private buildExtractedFiles(
    packageDir: string,
    fileEntries: Map<string, { type: string; content?: string; fullPath: string }>,
    requiredDirs: Set<string>
  ): ExtractedFileMap {
    const sortedDirs = Array.from(requiredDirs).sort(
      (a, b) => a.split('/').length - b.split('/').length
    );
    const result: ExtractedFileMap = new Map();
    for (const d of sortedDirs) {
      result.set(d, { isDirectory: true, fullPath: `${packageDir}/${d}` });
    }
    for (const [rel, entry] of fileEntries) {
      if (entry.type === 'file') {
        result.set(rel, { isDirectory: false, content: entry.content, fullPath: entry.fullPath });
      }
    }
    return result;
  }

  async extractFromBuffer(packageDir: string, tarballData: ArrayBuffer): Promise<ExtractedFileMap> {
    const uint8Array = new Uint8Array(tarballData);
    let decompressed: Uint8Array;
    try {
      decompressed = pako.inflate(uint8Array);
    } catch {
      decompressed = uint8Array;
    }

    const extract = tarStream.extract();
    const fileEntries = new Map<string, { type: string; content?: string; fullPath: string }>();
    const requiredDirs = new Set<string>();

    extract.on('entry', (header: any, stream: any, next: any) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('end', () => {
        let rel = header.name;
        if (rel.startsWith('package/')) rel = rel.substring(8);
        if (!rel) { next(); return; }

        const fullPath = `${packageDir}/${rel}`;
        if (header.type === 'file') {
          const totalLen = chunks.reduce((s, c) => s + c.length, 0);
          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of chunks) { combined.set(c, offset); offset += c.length; }
          fileEntries.set(rel, { type: 'file', content: this.encodeContent(combined), fullPath });
          const parts = rel.split('/');
          for (let i = 0; i < parts.length - 1; i++) {
            requiredDirs.add(parts.slice(0, i + 1).join('/'));
          }
        } else if (header.type === 'directory') {
          fileEntries.set(rel, { type: 'directory', fullPath });
          requiredDirs.add(rel);
        }
        next();
      });
      stream.resume();
    });

    await new Promise<void>((resolve, reject) => {
      extract.on('finish', resolve);
      extract.on('error', reject);
      extract.write(decompressed);
      extract.end();
    });

    return this.buildExtractedFiles(packageDir, fileEntries, requiredDirs);
  }

  async extractFromStream(
    packageDir: string,
    decompressedStream: ReadableStream<Uint8Array>
  ): Promise<ExtractedFileMap> {
    const extract = tarStream.extract();
    const fileEntries = new Map<string, { type: string; content?: string; fullPath: string }>();
    const requiredDirs = new Set<string>();

    extract.on('entry', (header: any, stream: any, next: any) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('end', () => {
        let rel = header.name;
        if (rel.startsWith('package/')) rel = rel.substring(8);
        if (!rel) { next(); return; }

        const fullPath = `${packageDir}/${rel}`;
        if (header.type === 'file') {
          const totalLen = chunks.reduce((s, c) => s + c.length, 0);
          const combined = new Uint8Array(totalLen);
          let offset = 0;
          for (const c of chunks) { combined.set(c, offset); offset += c.length; }
          fileEntries.set(rel, { type: 'file', content: this.encodeContent(combined), fullPath });
          const parts = rel.split('/');
          for (let i = 0; i < parts.length - 1; i++) {
            requiredDirs.add(parts.slice(0, i + 1).join('/'));
          }
        } else if (header.type === 'directory') {
          fileEntries.set(rel, { type: 'directory', fullPath });
          requiredDirs.add(rel);
        }
        next();
      });
      stream.resume();
    });

    const reader = decompressedStream.getReader();
    const pump = (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          extract.write(value);
        }
        extract.end();
      } catch (err) {
        extract.destroy(err as Error);
      }
    })();

    await Promise.all([
      pump,
      new Promise<void>((resolve, reject) => {
        extract.on('finish', resolve);
        extract.on('error', reject);
      }),
    ]);

    return this.buildExtractedFiles(packageDir, fileEntries, requiredDirs);
  }

  createPakoDecompressedStream(
    bodyStream: ReadableStream<Uint8Array>
  ): ReadableStream<Uint8Array> {
    const reader = bodyStream.getReader();
    const inflate = new pako.Inflate();

    return new ReadableStream<Uint8Array>({
      start(controller) {
        function pushResult() {
          const out = (inflate as any).result;
          if (!out) return;
          if (out instanceof Uint8Array) controller.enqueue(out.slice());
          else if (typeof out === 'string') controller.enqueue(new TextEncoder().encode(out));
        }
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              inflate.push(value, false);
              pushResult();
            }
            inflate.push(new Uint8Array(), true);
            pushResult();
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        })();
      },
    });
  }
}
