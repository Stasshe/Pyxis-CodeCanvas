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
  let staged = new Uint8Array();
  let position = 0;
  const writable = {
    write: vi.fn(async (source: string | Uint8Array) => {
      let bytes: Uint8Array;
      if (typeof source === 'string') bytes = new TextEncoder().encode(source);
      else bytes = source;
      if (bytes.length === 0) return;
      const next = new Uint8Array(Math.max(staged.length, position + bytes.length));
      next.set(staged);
      next.set(bytes, position);
      staged = next;
      position += bytes.length;
    }),
    seek: vi.fn(async (offset: number) => {
      position = offset;
    }),
    close: vi.fn(async () => {
      data = staged;
    }),
    abort: vi.fn(async () => {
      staged = new Uint8Array();
    }),
  };
  const file = {
    kind: 'file' as const,
    name: 'file',
    getFile: async () => new File([data], 'file'),
    createSyncAccessHandle: vi.fn(async () => access),
    createWritable: vi.fn(async (options: FileSystemCreateWritableOptions = {}) => {
      staged = new Uint8Array();
      if (options.keepExistingData) staged = data.slice();
      position = 0;
      return writable as FileSystemWritableFileStream;
    }),
  };
  const root = {
    kind: 'directory' as const,
    name: '',
    getDirectoryHandle: async () => root,
    async *entries() {},
    getFileHandle: async () => file,
  } as FileSystemDirectoryHandle;
  return { root, access, writable, file, bytes: () => data };
}

interface DirectoryEntries {
  directories: Map<string, FileSystemDirectoryHandle>;
  files: Map<string, FileSystemFileHandle>;
}

interface FileLocation {
  directory: FileSystemDirectoryHandle;
  name: string;
}

const directoryEntries = new WeakMap<FileSystemDirectoryHandle, DirectoryEntries>();
const fileLocations = new WeakMap<FileSystemFileHandle, FileLocation>();

function attachFileMove(file: FileSystemFileHandle): void {
  Object.assign(file, {
    move: async (destination: FileSystemDirectoryHandle | string, newName?: string) => {
      const location = fileLocations.get(file);
      if (!location) throw new DOMException('Missing source file', 'NotFoundError');
      let targetDirectory = location.directory;
      let targetName = '';
      if (typeof destination === 'string') targetName = destination;
      else {
        targetDirectory = destination;
        targetName = newName ?? location.name;
      }
      if (!targetName || targetName === '.' || targetName === '..' || targetName.includes('/')) {
        throw new DOMException('Invalid file name', 'TypeError');
      }
      const targetEntries = directoryEntries.get(targetDirectory);
      const sourceEntries = directoryEntries.get(location.directory);
      if (!targetEntries || !sourceEntries) {
        throw new DOMException('Missing destination directory', 'NotFoundError');
      }
      if (targetEntries.directories.has(targetName)) {
        throw new DOMException('Destination is a directory', 'InvalidModificationError');
      }
      if (sourceEntries.files.get(location.name) !== file) {
        throw new DOMException('Missing source file', 'NotFoundError');
      }
      sourceEntries.files.delete(location.name);
      targetEntries.files.set(targetName, file);
      fileLocations.set(file, { directory: targetDirectory, name: targetName });
    },
  });
}

export function directoryTree(name = ''): FileSystemDirectoryHandle {
  const directories = new Map<string, FileSystemDirectoryHandle>();
  const files = new Map<string, FileSystemFileHandle>();
  const handle: FileSystemDirectoryHandle = {
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
        attachFileMove(file);
        files.set(child, file);
      }
      if (!file) throw new DOMException('Missing file', 'NotFoundError');
      fileLocations.set(file, { directory: handle, name: child });
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
  directoryEntries.set(handle, { directories, files });
  return handle;
}
