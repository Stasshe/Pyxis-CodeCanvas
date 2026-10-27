import { Buffer } from 'buffer';
import { type Loader, transformSync } from 'esbuild';
import { defaultMode, withPermissionBits } from '@/engine/core/fs/permissions';
import type { FifoMode, FifoOpenOptions } from '@/engine/core/fs/types';
import { getParentPath, normalizePath, resolvePath } from '@/engine/core/paths';
import type { RuntimeFilesystem } from '@/engine/system/runtime/bridge/endpoint';
import type {
  FsBenchmark,
  FsRequest,
  FsStat,
  RpcValue,
  RuntimeRequest,
} from '@/engine/system/runtime/bridge/protocol';
import {
  extractCjsDependencies,
  finalizeRuntimeCode,
  runtimeDefines,
} from '@/engine/system/runtime/transpiler/esmTransformer';
import type { ProjectFile } from '@/types/index';

type Entry =
  | { type: 'file'; data: Uint8Array; mode: number }
  | { type: 'directory'; mode: number }
  | { type: 'symlink'; target: string; mode: number };

const DEV_DIRECTORY = '/dev';
const NULL_DEVICE = `${DEV_DIRECTORY}/null`;

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

function unsupportedFifo(): Error & { code: string } {
  return Object.assign(new Error('MemoryFs does not support FIFOs.'), { code: 'ENOTSUP' });
}

function parent(path: string): string {
  const index = path.lastIndexOf('/');
  if (index === 0) return '/';
  return path.slice(0, index);
}

function base(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

export class MemoryFs implements RuntimeFilesystem {
  private readonly entries = new Map<string, Entry>([
    ['/', { type: 'directory', mode: defaultMode('folder') }],
  ]);

  hasDirectory(path: string): boolean {
    if (path === DEV_DIRECTORY) return true;
    return this.entries.get(path)?.type === 'directory';
  }

  async mkfifo(_path: string): Promise<void> {
    throw unsupportedFifo();
  }

  async openFifo(
    _path: string,
    _mode: FifoMode,
    _endpointId: string,
    _ownerId: string,
    _options?: FifoOpenOptions
  ): Promise<void> {
    throw unsupportedFifo();
  }

  async readFifo(_endpointId: string, _maxBytes: number): Promise<Uint8Array> {
    throw unsupportedFifo();
  }

  async writeFifo(_endpointId: string, _bytes: Uint8Array): Promise<number> {
    throw unsupportedFifo();
  }

  async closeFifo(_endpointId: string): Promise<void> {
    throw unsupportedFifo();
  }

  async closeFifos(_ownerId: string): Promise<void> {
    throw unsupportedFifo();
  }

  async readFile(path: string): Promise<Uint8Array> {
    if (path === NULL_DEVICE) return new Uint8Array();
    const entry = this.entries.get(this.realpathSync(path));
    if (!entry) throw missing(path);
    if (entry.type !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
    return entry.data.slice();
  }

  async writeFile(
    path: string,
    data: Uint8Array,
    _benchmark?: FsBenchmark,
    _ownerId?: string,
    mode?: number
  ): Promise<void> {
    this.writeFileSync(path, data, mode);
  }

  async writeRange(
    path: string,
    data: Uint8Array,
    position: number | null,
    create = false,
    exclusive = false,
    _benchmark?: FsBenchmark,
    mode?: number
  ): Promise<number> {
    return this.writeRangeSync(path, data, position, create, exclusive, mode);
  }

  async readdir(path: string): Promise<string[]> {
    return this.readdirSync(path);
  }

  async stat(path: string): Promise<FsStat> {
    return this.statSync(path);
  }

  async lstat(path: string): Promise<FsStat> {
    return this.lstatSync(path);
  }

  async readlink(path: string): Promise<string> {
    return this.readlinkSync(path);
  }

  async realpath(path: string): Promise<string> {
    return this.realpathSync(path);
  }

  async symlink(target: string, path: string): Promise<void> {
    this.symlinkSync(target, path);
  }

  private statSync(path: string): FsStat {
    if (path === NULL_DEVICE)
      return { type: 'characterDevice', size: 0, mtime: 1, mode: defaultMode('characterDevice') };
    if (path === DEV_DIRECTORY)
      return { type: 'directory', size: 0, mtime: 1, mode: defaultMode('folder') };
    const resolved = this.realpathSync(path);
    const entry = this.entries.get(resolved);
    if (!entry) throw missing(path);
    return {
      type: entry.type,
      size: this.lstatSync(resolved).size,
      mtime: 1,
      mode: entry.mode,
    };
  }

  async mkdir(path: string, options: { recursive: boolean; mode?: number }): Promise<void> {
    this.mkdirSync(path, options.recursive, options.mode);
  }

  async chmod(path: string, mode: number): Promise<void> {
    this.chmodSync(path, mode);
  }

  async rm(path: string, options: { recursive: boolean; force: boolean }): Promise<void> {
    this.rmSync(path, options.recursive, options.force);
  }

  async rename(path: string, newPath: string): Promise<void> {
    this.renameSync(path, newPath);
  }

  symlinkSync(target: string, input: string): void {
    const path = this.resolve(input, false);
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    if (this.entries.has(path))
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
    this.entries.set(path, { type: 'symlink', target, mode: defaultMode('symlink') });
  }

  private resolve(path: string, followFinal = true): string {
    normalizePath(path);
    const pending = path.split('/').filter(Boolean);
    let resolved = '/';
    let followed = 0;
    while (pending.length > 0) {
      const segment = pending.shift()!;
      if (segment === '.') {
        if (!this.hasDirectory(resolved))
          throw Object.assign(new Error(`ENOTDIR: ${resolved}`), { code: 'ENOTDIR' });
        continue;
      }
      if (segment === '..') {
        if (!this.hasDirectory(resolved))
          throw Object.assign(new Error(`ENOTDIR: ${resolved}`), { code: 'ENOTDIR' });
        resolved = getParentPath(resolved);
        continue;
      }
      resolved = resolvePath(resolved, segment);
      const entry = this.entries.get(resolved);
      if (
        !entry ||
        entry.type !== 'symlink' ||
        (!followFinal && !pending.length && !path.endsWith('/'))
      )
        continue;
      followed += 1;
      if (followed > 40) throw Object.assign(new Error(`ELOOP: ${path}`), { code: 'ELOOP' });
      if (entry.target.startsWith('/')) resolved = '/';
      else resolved = parent(resolved);
      pending.unshift(...entry.target.split('/').filter(Boolean));
    }
    if (path.endsWith('/') && !this.hasDirectory(resolved))
      throw Object.assign(new Error(`ENOTDIR: ${path}`), { code: 'ENOTDIR' });
    return resolved;
  }

  private realpathSync(path: string): string {
    if (path === NULL_DEVICE) return NULL_DEVICE;
    const resolved = this.resolve(path);
    if (!this.entries.has(resolved)) throw missing(path);
    return resolved;
  }

  private lstatSync(path: string): FsStat {
    if (path === NULL_DEVICE)
      return { type: 'characterDevice', size: 0, mtime: 1, mode: defaultMode('characterDevice') };
    if (path === DEV_DIRECTORY)
      return { type: 'directory', size: 0, mtime: 1, mode: defaultMode('folder') };
    const entry = this.entries.get(this.resolve(path, false));
    if (!entry) throw missing(path);
    let size = 0;
    if (entry.type === 'file') size = entry.data.byteLength;
    else if (entry.type === 'symlink') size = new TextEncoder().encode(entry.target).length;
    let type: FsStat['type'] = 'file';
    if (entry.type === 'directory') type = 'directory';
    else if (entry.type === 'symlink') type = 'symlink';
    return { type, size, mtime: 1, mode: entry.mode };
  }

  private readlinkSync(path: string): string {
    const entry = this.entries.get(this.resolve(path, false));
    if (!entry) throw missing(path);
    if (entry.type !== 'symlink')
      throw Object.assign(new Error(`EINVAL: ${path}`), { code: 'EINVAL' });
    return entry.target;
  }

  mkdirSync(input: string, recursive: boolean, mode?: number): void {
    const path = this.resolve(input.replace(/\/+$/, '') || '/', false);
    if (this.entries.has(path)) {
      if (recursive && this.hasDirectory(this.realpathSync(path))) return;
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
    }
    if (recursive && !this.hasDirectory(parent(path))) this.mkdirSync(parent(path), true);
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    this.entries.set(path, { type: 'directory', mode: this.fileMode('folder', mode) });
  }

  private chmodSync(input: string, mode: number): void {
    const path = this.realpathSync(input);
    const entry = this.entries.get(path);
    if (!entry) throw missing(input);
    entry.mode = withPermissionBits(this.projectType(entry.type), mode);
  }

  private fileMode(type: ProjectFile['type'], mode?: number): number {
    if (mode === undefined) return defaultMode(type);
    return withPermissionBits(type, mode);
  }

  private projectType(type: Entry['type']): ProjectFile['type'] {
    if (type === 'directory') return 'folder';
    return type;
  }

  rmSync(input: string, recursive: boolean, force: boolean): void {
    const path = this.resolve(input, false);
    const entry = this.entries.get(path);
    if (!entry) {
      if (force) return;
      throw missing(path);
    }
    if (entry.type === 'directory') {
      const children = [...this.entries.keys()].filter(
        candidate => candidate !== path && parent(candidate) === path
      );
      if (children.length && !recursive) {
        throw Object.assign(new Error(`ENOTEMPTY: ${path}`), { code: 'ENOTEMPTY' });
      }
      for (const candidate of [...this.entries.keys()]) {
        if (candidate === path || candidate.startsWith(`${path}/`)) this.entries.delete(candidate);
      }
      return;
    }
    this.entries.delete(path);
  }

  renameSync(input: string, newInput: string): void {
    const path = this.resolve(input, false);
    const newPath = this.resolve(newInput, false);
    const entry = this.entries.get(path);
    if (!entry) throw missing(path);
    if (!this.hasDirectory(parent(newPath))) throw missing(parent(newPath));
    if (entry.type !== 'directory') {
      this.entries.set(newPath, entry);
      this.entries.delete(path);
      return;
    }
    const descendants = [...this.entries.entries()].filter(
      ([candidate]) => candidate === path || candidate.startsWith(`${path}/`)
    );
    for (const [candidate, value] of descendants) {
      this.entries.set(`${newPath}${candidate.slice(path.length)}`, value);
    }
    this.rmSync(path, true, false);
  }

  sync(request: RuntimeRequest): RpcValue {
    if (request.kind === 'transpile') {
      let loader: Loader = 'js';
      if (request.isTypeScript && request.isJSX) loader = 'tsx';
      else if (request.isTypeScript) loader = 'ts';
      else if (request.isJSX) loader = 'jsx';
      const result = transformSync(request.code, {
        format: 'cjs',
        target: 'es2020',
        loader,
        platform: 'node',
        define: runtimeDefines(request.filePath),
      });
      const code = finalizeRuntimeCode(result.code);
      return { code, dependencies: extractCjsDependencies(code) };
    }
    if (request.kind !== 'fs') throw new Error('MemoryFs only handles filesystem requests.');
    const fsRequest: FsRequest = request;
    switch (fsRequest.op) {
      case 'readFile':
        return Buffer.from(this.readFileSync(fsRequest.path)).toString('base64');
      case 'writeFile':
        this.writeFileSync(fsRequest.path, Buffer.from(fsRequest.data, 'base64'), fsRequest.mode);
        return null;
      case 'writeRange':
        return this.writeRangeSync(
          fsRequest.path,
          Buffer.from(fsRequest.data, 'base64'),
          fsRequest.position,
          fsRequest.create,
          fsRequest.exclusive,
          fsRequest.mode
        );
      case 'readdir':
        return this.readdirSync(fsRequest.path);
      case 'stat':
        return this.statSync(fsRequest.path);
      case 'lstat':
        return this.lstatSync(fsRequest.path);
      case 'readlink':
        return this.readlinkSync(fsRequest.path);
      case 'realpath':
        return this.realpathSync(fsRequest.path);
      case 'symlink':
        this.symlinkSync(fsRequest.target, fsRequest.path);
        return null;
      case 'mkdir':
        this.mkdirSync(fsRequest.path, fsRequest.recursive, fsRequest.mode);
        return null;
      case 'chmod':
        this.chmodSync(fsRequest.path, fsRequest.mode);
        return null;
      case 'rm':
        this.rmSync(fsRequest.path, fsRequest.recursive, fsRequest.force);
        return null;
      case 'rename':
        this.renameSync(fsRequest.path, fsRequest.newPath);
        return null;
    }
  }

  private readFileSync(path: string): Uint8Array {
    if (path === NULL_DEVICE) return new Uint8Array();
    const entry = this.entries.get(this.realpathSync(path));
    if (!entry) throw missing(path);
    if (entry.type !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
    return entry.data.slice();
  }

  private writeFileSync(input: string, data: Uint8Array, mode?: number): void {
    if (input === NULL_DEVICE) return;
    const path = this.resolve(input);
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    const existing = this.entries.get(path);
    let fileMode = mode;
    if (existing?.type === 'file') fileMode = existing.mode;
    this.entries.set(path, {
      type: 'file',
      data: data.slice(),
      mode: this.fileMode('file', fileMode),
    });
  }

  private writeRangeSync(
    path: string,
    data: Uint8Array,
    position: number | null,
    create: boolean,
    exclusive: boolean,
    mode?: number
  ): number {
    if (position !== null && (!Number.isSafeInteger(position) || position < 0)) {
      throw Object.assign(new Error(`EINVAL: ${path}`), { code: 'EINVAL' });
    }
    if (path === NULL_DEVICE) return data.byteLength;
    const originalPath = this.resolve(path, false);
    if (exclusive && create && this.entries.has(originalPath)) {
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
    }
    const target = this.resolve(path);
    let current = this.entries.get(target);
    if (current && exclusive && create) {
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
    }
    if (!current) {
      if (!create) throw missing(path);
      this.writeFileSync(path, new Uint8Array(), mode);
      current = this.entries.get(target);
    }
    if (!current || current.type !== 'file') throw missing(path);
    const start = position ?? current.data.byteLength;
    const end = start + data.byteLength;
    if (!Number.isSafeInteger(end)) {
      throw Object.assign(new Error(`EINVAL: ${path}`), { code: 'EINVAL' });
    }
    if (data.byteLength > 0) {
      const next = new Uint8Array(Math.max(current.data.byteLength, end));
      next.set(current.data);
      next.set(data, start);
      this.writeFileSync(path, next);
    }
    return end;
  }

  private readdirSync(input: string): string[] {
    if (input === DEV_DIRECTORY) return ['null'];
    const path = this.realpathSync(input);
    if (!this.hasDirectory(path)) throw missing(path);
    return [...this.entries.keys()]
      .filter(entry => entry !== path && parent(entry) === path)
      .map(base);
  }
}
