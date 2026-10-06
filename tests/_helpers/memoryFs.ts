import { type Loader, transformSync } from 'esbuild';
import type { RuntimeFilesystem } from '@/engine/runtime/bridge/endpoint';
import type { FsRequest, FsStat, RpcValue, RuntimeRequest } from '@/engine/runtime/bridge/protocol';
import {
  extractCjsDependencies,
  finalizeRuntimeCode,
} from '@/engine/runtime/transpiler/esmTransformer';

type Entry = { type: 'file'; data: Uint8Array } | { type: 'directory' };

function missing(path: string): Error & { code: string } {
  return Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
}

function parent(path: string): string {
  const index = path.lastIndexOf('/');
  return index === 0 ? '/' : path.slice(0, index);
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
    const entry = this.entries.get(path);
    if (!entry) throw missing(path);
    if (entry.type !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
    return entry.data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    this.entries.set(path, { type: 'file', data: data.slice() });
  }

  async readdir(path: string): Promise<string[]> {
    if (!this.hasDirectory(path)) throw missing(path);
    return [...this.entries.keys()]
      .filter(entry => entry !== path && parent(entry) === path)
      .map(base);
  }

  async stat(path: string): Promise<FsStat> {
    const entry = this.entries.get(path);
    if (!entry) throw missing(path);
    return {
      type: entry.type,
      size: entry.type === 'file' ? entry.data.byteLength : 0,
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

  mkdirSync(path: string, recursive: boolean): void {
    if (this.entries.has(path)) {
      if (recursive && this.hasDirectory(path)) return;
      throw Object.assign(new Error(`EEXIST: ${path}`), { code: 'EEXIST' });
    }
    if (recursive && !this.hasDirectory(parent(path))) this.mkdirSync(parent(path), true);
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    this.entries.set(path, { type: 'directory' });
  }

  rmSync(path: string, recursive: boolean, force: boolean): void {
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

  renameSync(path: string, newPath: string): void {
    const entry = this.entries.get(path);
    if (!entry) throw missing(path);
    if (!this.hasDirectory(parent(newPath))) throw missing(parent(newPath));
    if (entry.type === 'file') {
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
    const entry = this.entries.get(path);
    if (!entry) throw missing(path);
    if (entry.type !== 'file')
      throw Object.assign(new Error(`EISDIR: ${path}`), { code: 'EISDIR' });
    return entry.data.slice();
  }

  private writeFileSync(path: string, data: Uint8Array): void {
    if (!this.hasDirectory(parent(path))) throw missing(parent(path));
    this.entries.set(path, { type: 'file', data: data.slice() });
  }

  private readdirSync(path: string): string[] {
    if (!this.hasDirectory(path)) throw missing(path);
    return [...this.entries.keys()]
      .filter(entry => entry !== path && parent(entry) === path)
      .map(base);
  }

  private statSync(path: string): FsStat {
    const entry = this.entries.get(path);
    if (!entry) throw missing(path);
    return {
      type: entry.type,
      size: entry.type === 'file' ? entry.data.byteLength : 0,
      mtime: 1,
    };
  }
}
