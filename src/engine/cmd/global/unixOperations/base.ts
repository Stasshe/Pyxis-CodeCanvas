import type TerminalUI from '@/engine/cmd/terminalUI';
import type { FsApi } from '@/engine/core/fs';
import { fsClient as defaultFsClient, FSError, normalizePath, resolvePath } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';

export class UnixCommandFailure extends Error {
  readonly stdout: string | Uint8Array;
  readonly code: number;

  constructor(message: string, code: number, stdout: string | Uint8Array = '') {
    super(message);
    this.name = 'UnixCommandFailure';
    this.stdout = stdout;
    this.code = code;
  }
}

export abstract class UnixCommandBase {
  protected _currentDir: string;
  protected rootPath: string;
  protected terminalUI?: TerminalUI;
  protected fs: FsApi;

  constructor(rootPath: string, currentDir: string, fs: FsApi = defaultFsClient) {
    this.rootPath = normalizePath(rootPath);
    this._currentDir = normalizePath(currentDir);
    this.fs = fs;
  }

  setTerminalUI(ui: TerminalUI): void {
    this.terminalUI = ui;
  }

  get currentDir(): string {
    return this._currentDir;
  }

  set currentDir(dir: string) {
    this._currentDir = normalizePath(dir);
  }

  protected async getFile(path: string): Promise<ProjectFile | undefined> {
    try {
      return await this.fs.stat(normalizePath(path));
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  protected getDescendants(path: string): Promise<ProjectFile[]> {
    return this.fs.walk(normalizePath(path));
  }

  protected resolvePath(path: string): string {
    return resolvePath(this.currentDir, path);
  }

  protected exists(path: string): Promise<boolean> {
    return this.fs.exists(normalizePath(path));
  }

  protected readText(path: string): Promise<string> {
    return this.fs.readText(normalizePath(path));
  }

  protected readBytes(path: string): Promise<Uint8Array> {
    return this.fs.readFile(normalizePath(path));
  }

  protected writeFile(path: string, data: string | Uint8Array): Promise<void> {
    return this.fs.writeFile(normalizePath(path), data);
  }

  protected async isDirectory(path: string): Promise<boolean> {
    return (await this.getFile(path))?.type === 'folder';
  }

  protected async isFile(path: string): Promise<boolean> {
    return (await this.getFile(path))?.type === 'file';
  }
}
