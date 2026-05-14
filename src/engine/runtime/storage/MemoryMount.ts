import type { MountStat, VirtualMount } from './types';

function parentDirs(path: string): string[] {
  const parts = path.split('/').filter(Boolean);
  const dirs: string[] = [];
  let current = '';
  for (const part of parts.slice(0, -1)) {
    current = `${current}/${part}`;
    dirs.push(current);
  }
  return dirs;
}

function contentSize(content: string | Uint8Array): number {
  return typeof content === 'string' ? new TextEncoder().encode(content).length : content.length;
}

export class MemoryMount implements VirtualMount {
  private files = new Map<string, string | Uint8Array>();
  private dirs = new Set<string>();

  constructor(rootPath: string) {
    this.dirs.add(rootPath);
  }

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
    return this.files.get(path);
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    for (const dir of parentDirs(path)) {
      this.dirs.add(dir);
    }
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<boolean> {
    return this.files.delete(path);
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      const parts = path.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = `${current}/${part}`;
        this.dirs.add(current);
      }
      return;
    }
    this.dirs.add(path);
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      for (const key of [...this.files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
      }
      for (const key of [...this.dirs]) {
        if (key === path || key.startsWith(`${path}/`)) this.dirs.delete(key);
      }
      return;
    }
    this.dirs.delete(path);
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const p of [...this.dirs, ...this.files.keys()]) {
      if (p.startsWith(prefix) && p !== path) {
        names.add(p.slice(prefix.length).split('/')[0]);
      }
    }
    return [...names].filter(Boolean);
  }

  async stat(path: string): Promise<MountStat | null> {
    if (this.dirs.has(path)) return { type: 'directory', size: 0, mtime: new Date() };
    const content = this.files.get(path);
    if (content === undefined) return null;
    return { type: 'file', size: contentSize(content), mtime: new Date() };
  }
}
