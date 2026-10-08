import { type Loader, transformSync } from 'esbuild';
import { getParentPath, normalizePath, resolvePath } from '@/engine/core/pathUtils';
import type { RuntimeFilesystem } from '@/engine/runtime/bridge/endpoint';
import type { FsRequest, FsStat, RpcValue, RuntimeRequest } from '@/engine/runtime/bridge/protocol';
import {
  extractCjsDependencies,
  finalizeRuntimeCode,
  runtimeDefines,
} from '@/engine/runtime/transpiler/esmTransformer';

type Entry =
  | { type: 'file'; data: Uint8Array }
  | { type: 'directory' }
  | { type: 'symlink'; target: string };

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
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
  private readonly entries = new Map<string, Entry>([['/', { type: 'directory' }]]);

  hasDirectory(path: string): boolean {
    return this.entries.get(path)?.type === 'directory';
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.entries.get(this.realpathSync(path));
    if (!entry) throw missing(path);
    if (entry.type !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
    return entry.data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    this.writeFileSync(path, data);
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
    const resolved = this.realpathSync(path);
    const entry = this.entries.get(resolved);
    if (!entry) throw missing(path);
    return {
      type: entry.type,
      size: this.lstatSync(resolved).size,
      mtime: 1,
    };
  }

  async mkdir(path: string, options: { recursive: boolean }): Promise<void> {
    this.mkdirSync(path, options.recursive);
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
    this.entries.set(path, { type: 'symlink', target });
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
    const resolved = this.resolve(path);
    if (!this.entries.has(resolved)) throw missing(path);
    return resolved;
  }

  private lstatSync(path: string): FsStat {
    const entry = this.entries.get(this.resolve(path, false));
    if (!entry) throw missing(path);
    let size = 0;
    if (entry.type === 'file') size = entry.data.byteLength;
    else if (entry.type === 'symlink') size = new TextEncoder().encode(entry.target).length;
    return { type: entry.type, size, mtime: 1 };
  }

  private readlinkSync(path: string): string {
    const entry = this.entries.get(this.resolve(path, false));
    if (!entry) throw missing(path);
    if (entry.type !== 'symlink')
      throw Object.assign(new Error(`EINVAL: ${path}`), { code: 'EINVAL' });
    return entry.target;
  }

  mkdirSync(input: string, recursive: boolean): void {
    const path = this.resolve(input.replace(/\/+$/, '') || '/', false);
    if (this.entries.has(path)) {
      if (recursive && this.hasDirectory(this.realpathSync(path))) return;
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
    }
    if (recursive && !this.hasDirectory(parent(path))) this.mkdirSync(parent(path), true);
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    this.entries.set(path, { type: 'directory' });
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
        return [...this.readFileSync(fsRequest.path)];
      case 'writeFile':
        this.writeFileSync(fsRequest.path, new Uint8Array(fsRequest.data));
        return null;
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
        this.mkdirSync(fsRequest.path, fsRequest.recursive);
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
    const entry = this.entries.get(this.realpathSync(path));
    if (!entry) throw missing(path);
    if (entry.type !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
    return entry.data.slice();
  }

  private writeFileSync(input: string, data: Uint8Array): void {
    const path = this.resolve(input);
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    this.entries.set(path, { type: 'file', data: data.slice() });
  }

  private readdirSync(input: string): string[] {
    const path = this.realpathSync(input);
    if (!this.hasDirectory(path)) throw missing(path);
    return [...this.entries.keys()]
      .filter(entry => entry !== path && parent(entry) === path)
      .map(base);
  }
}
