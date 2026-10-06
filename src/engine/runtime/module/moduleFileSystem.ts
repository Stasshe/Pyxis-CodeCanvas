import type { RuntimeBridge } from '../bridge/client';
import type { FsStat, RpcValue, RuntimeRequest } from '../bridge/protocol';
import { ModuleCode } from './moduleCode';

export class ModuleFileSystem {
  constructor(private readonly bridge: RuntimeBridge) {}

  async readFile(path: string): Promise<string> {
    const result = await this.bridge.async({ kind: 'fs', op: 'readFile', path });
    return this.decodeText(result, path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const data = Array.from(new TextEncoder().encode(content));
    await this.bridge.async({ kind: 'fs', op: 'writeFile', path, data });
  }

  async mkdir(path: string): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'mkdir', path, recursive: true });
  }

  async rm(path: string, recursive = false): Promise<void> {
    await this.bridge.async({ kind: 'fs', op: 'rm', path, recursive, force: true });
  }

  async readdir(path: string): Promise<string[]> {
    const result = await this.bridge.async({ kind: 'fs', op: 'readdir', path });
    if (
      !Array.isArray(result) ||
      !result.every((name): name is string => typeof name === 'string')
    ) {
      throw new Error(`Filesystem returned invalid directory entries for ${path}.`);
    }
    return result;
  }

  readFileSync(path: string): string {
    const result = this.bridge.sync({ kind: 'fs', op: 'readFile', path });
    return this.decodeText(result, path);
  }

  readOptionalFileSync(path: string): string | null {
    try {
      return this.readFileSync(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async readPackageJson(path: string): Promise<string | null> {
    try {
      return await this.readFile(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async readOptionalFile(path: string): Promise<string | null> {
    try {
      return await this.readFile(path);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async stat(path: string): Promise<FsStat | null> {
    try {
      return this.decodeStat(await this.bridge.async({ kind: 'fs', op: 'stat', path }));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  statSync(path: string): FsStat | null {
    try {
      return this.decodeStat(this.bridge.sync({ kind: 'fs', op: 'stat', path }));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async transpile(
    code: string,
    filePath: string,
    isTypeScript: boolean,
    isESModule: boolean
  ): Promise<{ code: string; dependencies: string[] }> {
    const request: RuntimeRequest = {
      kind: 'transpile',
      code,
      filePath,
      isTypeScript,
      isESModule,
      isJSX: /\.(jsx|tsx)$/.test(filePath),
    };
    return this.decodeTranspile(await this.bridge.async(request));
  }

  transpileSync(code: string, filePath: string): { code: string; dependencies: string[] } {
    const request: RuntimeRequest = {
      kind: 'transpile',
      code,
      filePath,
      isTypeScript: /\.(ts|tsx|mts|cts)$/.test(filePath),
      isESModule: ModuleCode.isESModule(code),
      isJSX: /\.(jsx|tsx)$/.test(filePath),
    };
    return this.decodeTranspile(this.bridge.sync(request));
  }

  private decodeText(value: RpcValue, path: string): string {
    if (!Array.isArray(value) || !value.every((byte): byte is number => typeof byte === 'number')) {
      throw new Error(`Filesystem returned invalid file data for ${path}.`);
    }
    return new TextDecoder().decode(new Uint8Array(value));
  }

  private decodeStat(value: RpcValue): FsStat {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('type' in value) ||
      (value.type !== 'file' && value.type !== 'directory') ||
      !('size' in value) ||
      typeof value.size !== 'number' ||
      !('mtime' in value) ||
      typeof value.mtime !== 'number'
    ) {
      throw new Error('Filesystem returned invalid stat data.');
    }
    return value as FsStat;
  }

  private decodeTranspile(value: RpcValue): { code: string; dependencies: string[] } {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('code' in value) ||
      typeof value.code !== 'string' ||
      !('dependencies' in value) ||
      !Array.isArray(value.dependencies) ||
      value.dependencies.some(dependency => typeof dependency !== 'string')
    ) {
      throw new Error('Transpile service returned invalid output.');
    }
    return value as { code: string; dependencies: string[] };
  }
}
