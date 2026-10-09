import { Buffer } from 'buffer';
import type { RuntimeBridge } from '../bridge/client';
import type { FsStat, RpcValue } from '../bridge/protocol';
import type { MountStat } from './types';

function encodedBytes(value: string | Uint8Array): string {
  return Buffer.from(value).toString('base64');
}

function decodedBytes(value: RpcValue, operation: string): Uint8Array {
  if (typeof value !== 'string')
    throw new Error(`Runtime filesystem returned an invalid ${operation} value.`);
  return Buffer.from(value, 'base64');
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

function stringValue(value: RpcValue, operation: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Runtime filesystem returned an invalid ${operation} value.`);
  }
  return value;
}

export class RuntimeFsMount {
  constructor(private readonly bridge: RuntimeBridge) {}

  getFileSync(path: string): Uint8Array | undefined {
    try {
      const value = this.bridge.sync({ kind: 'fs', op: 'readFile', path });
      return decodedBytes(value, 'file');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  setFileSync(path: string, content: string | Uint8Array): void {
    this.bridge.sync({ kind: 'fs', op: 'writeFile', path, data: encodedBytes(content) });
  }

  writeRangeSync(
    path: string,
    data: Uint8Array,
    position: number | null,
    create: boolean,
    exclusive = false
  ): number {
    const value = this.bridge.sync({
      kind: 'fs',
      op: 'writeRange',
      path,
      data: encodedBytes(data),
      position,
      create,
      exclusive,
    });
    if (typeof value !== 'number')
      throw new Error('Runtime filesystem returned an invalid write range value.');
    return value;
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
    return this.statRequestSync(path, 'stat');
  }

  lstatSync(path: string): MountStat | null {
    return this.statRequestSync(path, 'lstat');
  }

  private statRequestSync(path: string, op: 'stat' | 'lstat'): MountStat | null {
    try {
      const value = this.bridge.sync({ kind: 'fs', op, path });
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

  readlinkSync(path: string): string {
    return stringValue(this.bridge.sync({ kind: 'fs', op: 'readlink', path }), 'readlink');
  }

  realpathSync(path: string): string {
    return stringValue(this.bridge.sync({ kind: 'fs', op: 'realpath', path }), 'realpath');
  }

  symlinkSync(target: string, path: string): void {
    this.bridge.sync({ kind: 'fs', op: 'symlink', target, path });
  }

  renameSync(oldPath: string, newPath: string): void {
    this.bridge.sync({ kind: 'fs', op: 'rename', path: oldPath, newPath });
  }

  openFifoSync(
    path: string,
    mode: 'read' | 'write' | 'readwrite',
    endpointId: string,
    nonblocking: boolean
  ): void {
    this.bridge.sync({ kind: 'fs', op: 'fifoOpen', path, mode, endpointId, nonblocking });
  }

  readFifoSync(endpointId: string, maxBytes: number): Uint8Array {
    const value = this.bridge.sync({ kind: 'fs', op: 'fifoRead', endpointId, maxBytes });
    return decodedBytes(value, 'FIFO read');
  }

  writeFifoSync(endpointId: string, data: Uint8Array): number {
    const value = this.bridge.sync({
      kind: 'fs',
      op: 'fifoWrite',
      endpointId,
      data: encodedBytes(data),
    });
    if (typeof value !== 'number')
      throw new Error('Runtime filesystem returned an invalid FIFO write value.');
    return value;
  }

  closeFifoSync(endpointId: string): void {
    this.bridge.sync({ kind: 'fs', op: 'fifoClose', endpointId });
  }

  async openFifo(
    path: string,
    mode: 'read' | 'write' | 'readwrite',
    endpointId: string,
    nonblocking = false
  ): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'fifoOpen', path, mode, endpointId, nonblocking });
  }

  async readFifo(endpointId: string, maxBytes: number): Promise<Uint8Array> {
    const value = await this.bridge.async({ kind: 'fs', op: 'fifoRead', endpointId, maxBytes });
    return decodedBytes(value, 'FIFO read');
  }

  async writeFifo(endpointId: string, data: Uint8Array): Promise<number> {
    const value = await this.bridge.async({
      kind: 'fs',
      op: 'fifoWrite',
      endpointId,
      data: encodedBytes(data),
    });
    if (typeof value !== 'number')
      throw new Error('Runtime filesystem returned an invalid FIFO write value.');
    return value;
  }

  async closeFifo(endpointId: string): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'fifoClose', endpointId });
  }

  async getFile(path: string): Promise<Uint8Array | undefined> {
    try {
      const value = await this.bridge.async({ kind: 'fs', op: 'readFile', path });
      return decodedBytes(value, 'file');
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'writeFile', path, data: encodedBytes(content) });
  }

  async writeRange(
    path: string,
    data: Uint8Array,
    position: number | null,
    create: boolean,
    exclusive = false
  ): Promise<number> {
    const value = await this.bridge.async({
      kind: 'fs',
      op: 'writeRange',
      path,
      data: encodedBytes(data),
      position,
      create,
      exclusive,
    });
    if (typeof value !== 'number')
      throw new Error('Runtime filesystem returned an invalid write range value.');
    return value;
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
    return this.statRequest(path, 'stat');
  }

  async lstat(path: string): Promise<MountStat | null> {
    return this.statRequest(path, 'lstat');
  }

  private async statRequest(path: string, op: 'stat' | 'lstat'): Promise<MountStat | null> {
    try {
      const value = await this.bridge.async({ kind: 'fs', op, path });
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

  async readlink(path: string): Promise<string> {
    return stringValue(await this.bridge.async({ kind: 'fs', op: 'readlink', path }), 'readlink');
  }

  async realpath(path: string): Promise<string> {
    return stringValue(await this.bridge.async({ kind: 'fs', op: 'realpath', path }), 'realpath');
  }

  async symlink(target: string, path: string): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'symlink', target, path });
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'rename', path: oldPath, newPath });
  }
}
