import type { RuntimeBridge } from '../bridge/client';
import type { FsStat } from '../bridge/protocol';
import type { MountStat } from './types';

function bytes(value: string | Uint8Array): number[] {
  return [...(typeof value === 'string' ? new TextEncoder().encode(value) : value)];
}

function isFsStat(value: object): value is FsStat {
  return 'type' in value && 'mtime' in value && 'size' in value;
}

function isNotFound(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}

function mountStat(value: FsStat): MountStat {
  return { type: value.type, size: value.size, mtime: new Date(value.mtime) };
}

export class RuntimeFsMount {
  constructor(private readonly bridge: RuntimeBridge) {}

  getFileSync(path: string): Uint8Array | undefined {
    try {
      const value = this.bridge.sync({ kind: 'fs', op: 'readFile', path });
      if (!Array.isArray(value) || !value.every(item => typeof item === 'number')) {
        throw new Error('Runtime filesystem returned an invalid file value.');
      }
      return new Uint8Array(value);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  setFileSync(path: string, content: string | Uint8Array): void {
    this.bridge.sync({ kind: 'fs', op: 'writeFile', path, data: bytes(content) });
  }

  deleteFileSync(path: string): void {
    this.bridge.sync({ kind: 'fs', op: 'rm', path, recursive: false, force: false });
  }

  mkdirSync(path: string, recursive = false): void {
    this.bridge.sync({ kind: 'fs', op: 'mkdir', path, recursive });
  }

  rmdirSync(path: string, recursive = false): void {
    this.bridge.sync({ kind: 'fs', op: 'rm', path, recursive, force: false });
  }

  listDirSync(path: string): string[] {
    const value = this.bridge.sync({ kind: 'fs', op: 'readdir', path });
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
      throw new Error('Runtime filesystem returned an invalid directory listing.');
    }
    return value;
  }

  statSync(path: string): MountStat | null {
    try {
      const value = this.bridge.sync({ kind: 'fs', op: 'stat', path });
      if (value === null) return null;
      if (typeof value !== 'object' || Array.isArray(value) || !isFsStat(value)) {
        throw new Error('Runtime filesystem returned invalid stat data.');
      }
      return mountStat(value);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  renameSync(oldPath: string, newPath: string): void {
    this.bridge.sync({ kind: 'fs', op: 'rename', path: oldPath, newPath });
  }

  async getFile(path: string): Promise<Uint8Array | undefined> {
    try {
      const value = await this.bridge.async({ kind: 'fs', op: 'readFile', path });
      if (!Array.isArray(value) || !value.every(item => typeof item === 'number')) {
        throw new Error('Runtime filesystem returned an invalid file value.');
      }
      return new Uint8Array(value);
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'writeFile', path, data: bytes(content) });
  }

  async deleteFile(path: string): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'rm', path, recursive: false, force: false });
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'mkdir', path, recursive });
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'rm', path, recursive, force: false });
  }

  async listDir(path: string): Promise<string[]> {
    const value = await this.bridge.async({ kind: 'fs', op: 'readdir', path });
    if (!Array.isArray(value) || !value.every(item => typeof item === 'string')) {
      throw new Error('Runtime filesystem returned an invalid directory listing.');
    }
    return value;
  }

  async stat(path: string): Promise<MountStat | null> {
    try {
      const value = await this.bridge.async({ kind: 'fs', op: 'stat', path });
      if (value === null) return null;
      if (typeof value !== 'object' || Array.isArray(value) || !isFsStat(value)) {
        throw new Error('Runtime filesystem returned invalid stat data.');
      }
      return mountStat(value);
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'rename', path: oldPath, newPath });
  }
}
