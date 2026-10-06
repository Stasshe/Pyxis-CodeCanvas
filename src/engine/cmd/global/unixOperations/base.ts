import type TerminalUI from '@/engine/cmd/terminalUI';
import { FSError, fsClient, normalizePath, resolvePath } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';

export abstract class UnixCommandBase {
  protected _currentDir: string;
  protected rootPath: string;
  protected terminalUI?: TerminalUI;

  constructor(rootPath: string, currentDir: string) {
    this.rootPath = normalizePath(rootPath);
    this._currentDir = normalizePath(currentDir);
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
      return await fsClient.stat(normalizePath(path));
    } catch (error) {
      if (error instanceof FSError && error.code === 'ENOENT') return undefined;
      throw error;
    }
  }

  protected getDescendants(path: string): Promise<ProjectFile[]> {
    return fsClient.walk(normalizePath(path));
  }

  protected resolvePath(path: string): string {
    return resolvePath(this.currentDir, path);
  }

  protected exists(path: string): Promise<boolean> {
    return fsClient.exists(normalizePath(path));
  }

  protected readText(path: string): Promise<string> {
    return fsClient.readText(normalizePath(path));
  }

  protected readBytes(path: string): Promise<Uint8Array> {
    return fsClient.readFile(normalizePath(path));
  }

  protected writeFile(path: string, data: string | Uint8Array): Promise<void> {
    return fsClient.writeFile(normalizePath(path), data);
  }

  protected async isDirectory(path: string): Promise<boolean> {
    return (await this.getFile(path))?.type === 'folder';
  }

  protected async isFile(path: string): Promise<boolean> {
    return (await this.getFile(path))?.type === 'file';
  }
}
