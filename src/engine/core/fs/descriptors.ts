import type { ProjectFile } from '@/types';
import { FSError } from './errors';
import type { FifoEndpoint, FileReference } from './fifo';
import { mountRoot } from './layout';
import type { WriteRange } from './write';

const DEVICE_PATH = '/dev';
const DESCRIPTOR_PATH = '/dev/fd';
const NULL_PATH = '/dev/null';

/** Numeric aliases refer to open endpoints, never ordinary filesystem entries. */
export class FifoDescriptors {
  private readonly endpoints = new Map<string, FifoEndpoint>();
  // Standard input, output and error belong to the calling process outside the FS worker.
  private nextDescriptor = 3;

  allocate(endpoint: FifoEndpoint): string {
    const path = `${DESCRIPTOR_PATH}/${this.nextDescriptor++}`;
    this.endpoints.set(path, endpoint);
    return path;
  }

  release(endpoint: FifoEndpoint): void {
    if (this.endpoints.get(endpoint.descriptorPath) === endpoint) {
      this.endpoints.delete(endpoint.descriptorPath);
    }
  }

  lookup(path: string): FileReference | undefined {
    if (path === DEVICE_PATH || path === DESCRIPTOR_PATH) throw new FSError('EISDIR', path);
    if (path === NULL_PATH) return { kind: 'null' };
    if (path.startsWith(`${NULL_PATH}/`)) throw new FSError('ENOTDIR', path);
    if (!path.startsWith(`${DESCRIPTOR_PATH}/`)) return;
    const separator = path.indexOf('/', DESCRIPTOR_PATH.length + 1);
    if (separator >= 0) {
      this.lookup(path.slice(0, separator));
      throw new FSError('ENOTDIR', path);
    }
    const endpoint = this.endpoints.get(path);
    if (!endpoint?.inode || !endpoint.opened || endpoint.closed) throw new FSError('ENOENT', path);
    return { kind: 'fifo', inode: endpoint.inode, opened: true };
  }

  stat(path: string): ProjectFile | undefined {
    if (path === DEVICE_PATH || path === DESCRIPTOR_PATH) return this.folder(path);
    const reference = this.lookup(path);
    if (reference?.kind === 'null') return { path, type: 'characterDevice', size: 0, mtime: 0 };
    if (reference) return { path, type: 'fifo', size: 0, mtime: 0 };
  }

  async *physicalNames(
    path: string,
    directory: () => Promise<FileSystemDirectoryHandle>,
    initialized: boolean
  ): AsyncGenerator<string> {
    const virtual = this.stat(path)?.type === 'folder';
    if (virtual && !initialized) return;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await directory();
    } catch (error) {
      if (virtual && error instanceof FSError && error.code === 'ENOENT') return;
      throw error;
    }
    for await (const [name] of handle.entries()) yield name;
  }

  async readdir(path: string, regular: () => Promise<ProjectFile[]>): Promise<ProjectFile[]> {
    if (path === DESCRIPTOR_PATH) {
      const entries: ProjectFile[] = [];
      for (const [alias, endpoint] of this.endpoints) {
        if (endpoint.opened && !endpoint.closed && endpoint.inode) {
          entries.push({ path: alias, type: 'fifo', size: 0, mtime: 0 });
        }
      }
      return entries.sort((a, b) => a.path.localeCompare(b.path));
    }
    if (this.lookupFile(path)) throw new FSError('ENOTDIR', path);
    let entries = await regular();
    const children: ProjectFile[] = [];
    if (path === '/') children.push(this.folder(DEVICE_PATH));
    else if (path === DEVICE_PATH) {
      children.push(this.folder(DESCRIPTOR_PATH), {
        path: NULL_PATH,
        type: 'characterDevice',
        size: 0,
        mtime: 0,
      });
    }
    entries = [
      ...entries.filter(entry => !children.some(child => child.path === entry.path)),
      ...children,
    ];
    return entries.sort((a, b) => a.path.localeCompare(b.path));
  }

  assertMutable(path: string): void {
    if (path === DEVICE_PATH || path === DESCRIPTOR_PATH) throw new FSError('EBUSY', path);
    if (path === NULL_PATH || path.startsWith(`${DESCRIPTOR_PATH}/`))
      throw new FSError('EPERM', path);
  }

  assertStored(path: string, namedFifo: boolean): void {
    if (namedFifo || this.lookup(path)?.kind === 'fifo') throw new FSError('ESPIPE', path);
  }

  writeNull(path: string, data: Uint8Array, range?: WriteRange): number | undefined {
    if (path !== NULL_PATH) return;
    if (range) return 0;
    return data.byteLength;
  }

  private lookupFile(path: string): FileReference | undefined {
    if (path === DEVICE_PATH || path === DESCRIPTOR_PATH) return;
    return this.lookup(path);
  }

  private folder(path: string): ProjectFile {
    if (path === DEVICE_PATH) return mountRoot(path, 'devices');
    return { path, type: 'folder', size: 0, mtime: 0 };
  }
}
