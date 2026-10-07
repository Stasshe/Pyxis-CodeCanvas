import pako from 'pako';
import tarStream from 'tar-stream';
import { isPathWithin, posixPath, resolvePath } from '@/engine/core/fs';

import type { ExtractedFileMap } from './types';

export class TarExtractor {
  private textDecoder = new TextDecoder('utf-8', { fatal: true });

  private processEntry(
    header: tarStream.Headers,
    chunks: Uint8Array[],
    packageDir: string,
    fileEntries: Map<string, { type: string; content?: string | Uint8Array; fullPath: string }>,
    requiredDirs: Set<string>
  ): void {
    let entryName = header.name;
    if (entryName.startsWith('package/')) entryName = entryName.substring(8);
    if (!entryName || posixPath.isAbsolute(entryName)) return;
    const fullPath = resolvePath(packageDir, entryName);
    if (!isPathWithin(fullPath, packageDir) || fullPath === packageDir) return;
    const rel = posixPath.relative(packageDir, fullPath);
    if (header.type === 'file') {
      const totalLen = chunks.reduce((s, c) => s + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const c of chunks) {
        combined.set(c, offset);
        offset += c.length;
      }
      let content: string | Uint8Array = combined;
      if (rel.endsWith('.mjs')) content = this.textDecoder.decode(combined);
      fileEntries.set(rel, { type: 'file', content, fullPath });
      const parts = rel.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        requiredDirs.add(parts.slice(0, i + 1).join('/'));
      }
    } else if (header.type === 'directory') {
      fileEntries.set(rel, { type: 'directory', fullPath });
      requiredDirs.add(rel);
    }
  }

  private buildExtractedFiles(
    packageDir: string,
    fileEntries: Map<string, { type: string; content?: string | Uint8Array; fullPath: string }>,
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
    const decompressed = pako.inflate(uint8Array);

    const extract = tarStream.extract();
    const fileEntries = new Map<
      string,
      { type: string; content?: string | Uint8Array; fullPath: string }
    >();
    const requiredDirs = new Set<string>();

    extract.on('entry', (header, stream, next) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('end', () => {
        try {
          this.processEntry(header, chunks, packageDir, fileEntries, requiredDirs);
          next();
        } catch (error) {
          extract.destroy(new Error(String(error)));
        }
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
    const fileEntries = new Map<
      string,
      { type: string; content?: string | Uint8Array; fullPath: string }
    >();
    const requiredDirs = new Set<string>();

    extract.on('entry', (header, stream, next) => {
      const chunks: Uint8Array[] = [];
      stream.on('data', (chunk: Uint8Array) => chunks.push(chunk));
      stream.on('end', () => {
        try {
          this.processEntry(header, chunks, packageDir, fileEntries, requiredDirs);
          next();
        } catch (error) {
          extract.destroy(new Error(String(error)));
        }
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
        extract.destroy(err instanceof Error ? err : new Error(String(err)));
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

  createPakoDecompressedStream(bodyStream: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
    const reader = bodyStream.getReader();
    const inflate = new pako.Inflate();

    return new ReadableStream<Uint8Array>({
      start(controller) {
        inflate.onData = chunk => {
          if (chunk instanceof Uint8Array) controller.enqueue(chunk);
          else controller.enqueue(new Uint8Array(chunk));
        };

        function throwOnInflateError() {
          if (inflate.err !== 0) {
            throw new Error(inflate.msg || `Gzip decompression failed (${inflate.err})`);
          }
        }
        (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              inflate.push(value, false);
              throwOnInflateError();
            }
            inflate.push(new Uint8Array(), true);
            throwOnInflateError();
            controller.close();
          } catch (err) {
            controller.error(err);
          }
        })();
      },
    });
  }
}
