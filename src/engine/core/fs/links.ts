import { FSError } from './errors';

export const LINK_STORAGE = '.pyxis-fs-links';

export interface LinkEntry {
  path: string;
  target: string;
  mtime: number;
}

interface LinkHandle extends FileSystemFileHandle {
  createSyncAccessHandle(): Promise<{
    write(bytes: Uint8Array, options: { at: number }): number;
    truncate(size: number): void;
    flush(): void;
    close(): void;
  }>;
}

/** Link records are the entries themselves; ordinary file payloads have no markers. */
export class Links {
  readonly entries = new Map<string, LinkEntry>();
  private directory: FileSystemDirectoryHandle | null = null;

  async init(root: FileSystemDirectoryHandle): Promise<void> {
    this.directory = await root.getDirectoryHandle(LINK_STORAGE, { create: true });
    this.entries.clear();
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

  async create(path: string, target: string): Promise<void> {
    const record = { path, target, mtime: Date.now() };
    if (!path.startsWith('/tmp/')) {
      if (!this.directory) throw new Error('FS Core is not initialized');
      const name = await this.name(path);
      const handle = (await this.directory.getFileHandle(name, {
        create: true,
      })) as LinkHandle;
      try {
        const access = await handle.createSyncAccessHandle();
        try {
          const data = new TextEncoder().encode(JSON.stringify(record));
          let offset = 0;
          while (offset < data.length) {
            const count = access.write(data.subarray(offset), { at: offset });
            if (!count) throw new FSError('EIO', path);
            offset += count;
          }
          access.truncate(data.length);
          access.flush();
        } finally {
          access.close();
        }
      } catch (error) {
        await this.directory.removeEntry(name);
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
