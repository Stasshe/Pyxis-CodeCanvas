import { vi } from 'vitest';

export function storage(initial: Uint8Array) {
  let data = initial.slice();
  const close = vi.fn();
  const access = {
    getSize: () => data.length,
    read: vi.fn((target: Uint8Array, { at }: { at: number }) => {
      const bytes = data.subarray(at, at + target.length);
      target.set(bytes);
      return bytes.length;
    }),
    write: vi.fn((source: Uint8Array, { at }: { at: number }) => {
      const next = new Uint8Array(Math.max(data.length, at + source.length));
      next.set(data);
      next.set(source, at);
      data = next;
      return source.length;
    }),
    truncate: vi.fn((size: number) => {
      const next = new Uint8Array(size);
      next.set(data.subarray(0, size));
      data = next;
    }),
    flush: vi.fn(),
    close,
  };
  const file = {
    kind: 'file' as const,
    name: 'file',
    getFile: async () => new File([data], 'file'),
    createSyncAccessHandle: vi.fn(async () => access),
  };
  const root = {
    kind: 'directory' as const,
    name: '',
    getDirectoryHandle: async () => root,
    async *entries() {},
    getFileHandle: async () => file,
  } as FileSystemDirectoryHandle;
  return { root, access, file, bytes: () => data };
}

export function directoryTree(name = ''): FileSystemDirectoryHandle {
  const directories = new Map<string, FileSystemDirectoryHandle>();
  const files = new Map<string, FileSystemFileHandle>();
  return {
    kind: 'directory',
    name,
    async getDirectoryHandle(child: string, options: FileSystemGetDirectoryOptions = {}) {
      if (files.has(child)) throw new DOMException('File exists', 'TypeMismatchError');
      let directory = directories.get(child);
      if (!directory && options.create) {
        directory = directoryTree(child);
        directories.set(child, directory);
      }
      if (!directory) throw new DOMException('Missing directory', 'NotFoundError');
      return directory;
    },
    async getFileHandle(child: string, options: FileSystemGetFileOptions = {}) {
      if (directories.has(child)) throw new DOMException('Directory exists', 'TypeMismatchError');
      let file = files.get(child);
      if (!file && options.create) {
        file = storage(new Uint8Array()).file as FileSystemFileHandle;
        files.set(child, file);
      }
      if (!file) throw new DOMException('Missing file', 'NotFoundError');
      return file;
    },
    async removeEntry(child: string, options: FileSystemRemoveOptions = {}) {
      const directory = directories.get(child);
      if (directory && !options.recursive) {
        const first = await directory.entries().next();
        if (!first.done)
          throw new DOMException('Directory is not empty', 'InvalidModificationError');
      }
      if (!directories.delete(child) && !files.delete(child)) {
        throw new DOMException('Missing entry', 'NotFoundError');
      }
    },
    async *entries() {
      yield* directories.entries();
      yield* files.entries();
    },
  } as FileSystemDirectoryHandle;
}
