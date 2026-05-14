import { fileRepository } from '@/engine/core/fileRepository';
import type { MountStat, VirtualMount } from './types';

function contentSize(content: string | Uint8Array): number {
  return typeof content === 'string' ? new TextEncoder().encode(content).length : content.length;
}

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy.buffer;
}

export class ProjectMount implements VirtualMount {
  private files = new Map<string, string | Uint8Array>();
  private dirs = new Set<string>(['/']);

  constructor(private readonly projectId: string) {}

  hasFile(path: string): boolean {
    return this.files.has(path);
  }

  hasDir(path: string): boolean {
    return this.dirs.has(path);
  }

  getFileSync(path: string): string | Uint8Array | undefined {
    return this.files.get(path);
  }

  async getFile(path: string): Promise<string | Uint8Array | undefined> {
    const cached = this.files.get(path);
    if (cached !== undefined) return cached;

    const file = await fileRepository.getFileByPath(this.projectId, path);
    if (!file || file.type !== 'file') return undefined;

    const content =
      file.isBufferArray && file.bufferContent
        ? new Uint8Array(file.bufferContent)
        : (file.content ?? '');
    this.rememberPath(path, 'file');
    this.files.set(path, content);
    return content;
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    this.rememberPath(path, 'file');
    this.files.set(path, content);

    const existingFile = await fileRepository.getFileByPath(this.projectId, path);
    if (existingFile) {
      await fileRepository.saveFile({
        ...existingFile,
        content: typeof content === 'string' ? content : '',
        isBufferArray: typeof content !== 'string',
        bufferContent: typeof content === 'string' ? undefined : toArrayBuffer(content),
        updatedAt: new Date(),
      });
      return;
    }

    await fileRepository.createFile(
      this.projectId,
      path,
      typeof content === 'string' ? content : '',
      'file',
      typeof content !== 'string',
      typeof content === 'string' ? undefined : toArrayBuffer(content)
    );
  }

  async deleteFile(path: string): Promise<boolean> {
    this.files.delete(path);
    const file = await fileRepository.getFileByPath(this.projectId, path);
    if (!file || file.type !== 'file') return false;
    await fileRepository.deleteFile(file.id);
    return true;
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      const parts = path.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = `${current}/${part}`;
        await this.ensureDir(current);
      }
      return;
    }

    await this.ensureDir(path);
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    const folder = await fileRepository.getFileByPath(this.projectId, path);
    if (!folder || folder.type !== 'folder') return;

    if (recursive) {
      for (const key of [...this.files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
      }
      for (const key of [...this.dirs]) {
        if (key === path || key.startsWith(`${path}/`)) this.dirs.delete(key);
      }
    } else {
      this.dirs.delete(path);
    }

    await fileRepository.deleteFile(folder.id);
  }

  async listDir(path: string): Promise<string[]> {
    const dirPath = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    const files =
      typeof fileRepository.getFilesByPrefix === 'function'
        ? await fileRepository.getFilesByPrefix(this.projectId, dirPath)
        : await fileRepository.getProjectFiles(this.projectId);

    for (const file of files) {
      if (file.path.startsWith(dirPath) && file.path !== dirPath) {
        names.add(file.path.slice(dirPath.length).split('/')[0]);
        this.rememberPath(file.path, file.type);
        if (file.type === 'file' && file.content !== undefined) {
          this.files.set(file.path, file.content);
        }
      }
    }

    for (const p of [...this.dirs, ...this.files.keys()]) {
      if (p.startsWith(dirPath) && p !== path) {
        names.add(p.slice(dirPath.length).split('/')[0]);
      }
    }

    return [...names].filter(Boolean);
  }

  async stat(path: string): Promise<MountStat | null> {
    if (this.dirs.has(path)) return { type: 'directory', size: 0, mtime: new Date() };
    const cached = this.files.get(path);
    if (cached !== undefined) return { type: 'file', size: contentSize(cached), mtime: new Date() };

    const file = await fileRepository.getFileByPath(this.projectId, path);
    if (!file) return null;

    this.rememberPath(path, file.type);
    if (file.type === 'folder') {
      return { type: 'directory', size: 0, mtime: file.updatedAt };
    }

    const content =
      file.isBufferArray && file.bufferContent
        ? new Uint8Array(file.bufferContent)
        : (file.content ?? '');
    this.files.set(path, content);
    return { type: 'file', size: contentSize(content), mtime: file.updatedAt };
  }

  async preload(extensions: string[] = ['.json', '.txt', '.md']): Promise<number> {
    const files = await fileRepository.getProjectFiles(this.projectId);
    let count = 0;
    for (const file of files) {
      this.rememberPath(file.path, file.type);
      if (
        file.type === 'file' &&
        file.content !== undefined &&
        (extensions.length === 0 || extensions.some(ext => file.path.endsWith(ext)))
      ) {
        this.files.set(file.path, file.content);
        count++;
      }
    }
    return count;
  }

  private async ensureDir(path: string): Promise<void> {
    this.rememberPath(path, 'folder');
    const folder = await fileRepository.getFileByPath(this.projectId, path);
    if (!folder) {
      await fileRepository.createFile(this.projectId, path, '', 'folder');
    }
  }

  private rememberPath(path: string, type: 'file' | 'folder'): void {
    let current = '/';
    for (const part of path
      .split('/')
      .filter(Boolean)
      .slice(0, type === 'file' ? -1 : undefined)) {
      current = current === '/' ? `/${part}` : `${current}/${part}`;
      this.dirs.add(current);
    }

    if (type === 'folder') {
      this.dirs.add(path);
    }
  }
}
