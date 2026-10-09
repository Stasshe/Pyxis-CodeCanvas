export const LINK_STORAGE = '.pyxis-fs-links';

export interface LinkEntry {
  path: string;
  target: string;
  mtime: number;
}

/** Link records are the entries themselves; ordinary file payloads have no markers. */
export class Links {
  readonly entries = new Map<string, LinkEntry>();
  private directory: FileSystemDirectoryHandle | null = null;

  async init(root: FileSystemDirectoryHandle): Promise<void> {
    this.directory = await root.getDirectoryHandle(LINK_STORAGE, { create: true });
    for (const path of this.entries.keys())
      if (!path.startsWith('/tmp/')) this.entries.delete(path);
    for await (const [name] of this.directory.entries()) {
      const handle = await this.directory.getFileHandle(name);
      const record = JSON.parse(await (await handle.getFile()).text()) as LinkEntry;
      if (
        !record ||
        typeof record.path !== 'string' ||
        !record.path.startsWith('/') ||
        typeof record.target !== 'string' ||
        typeof record.mtime !== 'number'
      )
        throw new Error(`Invalid symbolic link record: ${name}`);
      this.entries.set(record.path, record);
    }
  }

  private async name(path: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async create(path: string, target: string, mtime = Date.now()): Promise<void> {
    const record = { path, target, mtime };
    if (!path.startsWith('/tmp/')) {
      if (!this.directory) throw new Error('FS Core is not initialized');
      const name = await this.name(path);
      let existed = true;
      let handle: FileSystemFileHandle;
      try {
        handle = await this.directory.getFileHandle(name);
      } catch (error) {
        if (!(error instanceof DOMException) || error.name !== 'NotFoundError') throw error;
        existed = false;
        handle = await this.directory.getFileHandle(name, { create: true });
      }
      let writer: FileSystemWritableFileStream | undefined;
      try {
        writer = await handle.createWritable();
        await writer.write(JSON.stringify(record));
        await writer.close();
      } catch (error) {
        const failures = [error];
        if (writer) {
          try {
            await writer.abort();
          } catch (abortError) {
            failures.push(abortError);
          }
        }
        if (!existed) {
          try {
            await this.directory.removeEntry(name);
          } catch (cleanupError) {
            failures.push(cleanupError);
          }
        }
        if (failures.length > 1) {
          throw new AggregateError(failures, `Failed to persist symbolic link ${path}`);
        }
        throw error;
      }
    }
    this.entries.set(path, record);
  }

  async remove(path: string): Promise<void> {
    if (!path.startsWith('/tmp/')) {
      if (!this.directory) throw new Error('FS Core is not initialized');
      await this.directory.removeEntry(await this.name(path));
    }
    this.entries.delete(path);
  }
}
