import tarStream from 'tar-stream';
import { isPathWithin, posixPath, resolvePath } from '@/engine/core/fs/index';

export type TarEntry =
  | { type: 'file'; path: string; content: Uint8Array }
  | { type: 'directory'; path: string }
  | { type: 'symlink'; path: string; target: string };

type EntryConsumer = (entry: TarEntry) => Promise<void>;

function drain(extract: tarStream.Extract): Promise<void> {
  return new Promise((resolve, reject) => {
    function cleanup() {
      extract.off('drain', ready);
      extract.off('error', failed);
      extract.off('close', closed);
    }
    function ready() {
      cleanup();
      resolve();
    }
    function failed(error: Error) {
      cleanup();
      reject(error);
    }
    function closed() {
      failed(new Error('Tar extraction stopped before draining.'));
    }
    if (extract.destroyed) {
      closed();
      return;
    }
    extract.once('drain', ready);
    extract.once('error', failed);
    extract.once('close', closed);
  });
}

export class TarExtractor {
  private entryPath(packageDir: string, header: tarStream.Headers): string | null {
    if (header.type !== 'file' && header.type !== 'directory' && header.type !== 'symlink')
      return null;
    const archivePath = posixPath.normalize(header.name);
    if (posixPath.isAbsolute(archivePath) || archivePath === '..' || archivePath.startsWith('../'))
      return null;
    const name = archivePath.split('/').slice(1).join('/');
    if (!name) return null;
    const path = resolvePath(packageDir, name);
    if (path === packageDir || !isPathWithin(path, packageDir)) return null;
    return path;
  }

  async extractFromStream(
    packageDir: string,
    stream: ReadableStream<Uint8Array>,
    onEntry: EntryConsumer
  ): Promise<void> {
    const extract = tarStream.extract();
    const reader = stream.getReader();
    let stopped = false;
    const pump = (async () => {
      while (!stopped) {
        const { done, value } = await reader.read();
        if (done || stopped) break;
        if (!extract.write(value)) await drain(extract);
      }
      if (!stopped) extract.end();
    })();
    const consume = (async () => {
      for await (const entry of extract) {
        try {
          const path = this.entryPath(packageDir, entry.header);
          let content: Uint8Array | null = null;
          if (path && entry.header.type === 'file') {
            content = new Uint8Array(entry.header.size ?? 0);
          }
          let offset = 0;
          for await (const chunk of entry) {
            if (content) {
              content.set(chunk, offset);
              offset += chunk.byteLength;
            }
          }
          if (path && content) {
            if (offset !== content.byteLength) throw new Error(`Truncated tar entry: ${path}`);
            await onEntry({ type: 'file', path, content });
          } else if (path && entry.header.type === 'directory') {
            await onEntry({ type: 'directory', path });
          } else if (path && entry.header.type === 'symlink') {
            if (!entry.header.linkname) throw new Error(`Symlink has no target: ${path}`);
            await onEntry({ type: 'symlink', path, target: entry.header.linkname });
          }
        } catch (error) {
          let failure = new Error(String(error));
          if (error instanceof Error) failure = error;
          extract.destroy(failure);
          throw failure;
        }
      }
    })();
    try {
      await Promise.all([pump, consume]);
    } catch (error) {
      let failure = new Error(String(error));
      if (error instanceof Error) failure = error;
      stopped = true;
      extract.destroy(failure);
      // Preserve the extraction failure when cancelling an already errored gzip stream.
      await reader.cancel().catch(() => {});
      await Promise.allSettled([pump, consume]);
      throw failure;
    } finally {
      reader.releaseLock();
    }
  }
}
