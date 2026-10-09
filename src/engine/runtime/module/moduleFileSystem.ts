import { Buffer } from 'buffer';
import type { RuntimeBridge } from '../bridge/client';
import type { FsStat, RpcValue, RuntimeRequest } from '../bridge/protocol';
import { ModuleCode, type ModuleDependency } from './moduleCode';

export class ModuleFileSystem {
  constructor(private readonly bridge: RuntimeBridge) {}

  async realpath(path: string): Promise<string> {
    return this.decodePath(await this.bridge.async({ kind: 'fs', op: 'realpath', path }));
  }

  realpathSync(path: string): string {
    return this.decodePath(this.bridge.sync({ kind: 'fs', op: 'realpath', path }));
  }

  private decodePath(value: RpcValue): string {
    if (typeof value !== 'string') throw new Error('Filesystem returned invalid realpath data.');
    return value;
  }

  async readFile(path: string): Promise<string> {
    const result = await this.bridge.async({ kind: 'fs', op: 'readFile', path });
    return this.decodeText(result, path);
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
    isTypeScript: boolean
  ): Promise<{ code: string; dependencies: ModuleDependency[] }> {
    const request: RuntimeRequest = {
      kind: 'transpile',
      code,
      filePath,
      isTypeScript,
      isJSX: filePath.endsWith('.jsx') || filePath.endsWith('.tsx'),
    };
    return this.decodeTranspile(await this.bridge.async(request));
  }

  transpileSync(
    code: string,
    filePath: string
  ): { code: string; dependencies: ModuleDependency[] } {
    const request: RuntimeRequest = {
      kind: 'transpile',
      code,
      filePath,
      isTypeScript: ModuleCode.isTypeScript(filePath),
      isJSX: filePath.endsWith('.jsx') || filePath.endsWith('.tsx'),
    };
    return this.decodeTranspile(this.bridge.sync(request));
  }

  private decodeText(value: RpcValue, path: string): string {
    if (typeof value !== 'string') {
      throw new Error(`Filesystem returned invalid file data for ${path}.`);
    }
    return Buffer.from(value, 'base64').toString('utf8');
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

  private decodeTranspile(value: RpcValue): { code: string; dependencies: ModuleDependency[] } {
    if (
      value === null ||
      typeof value !== 'object' ||
      !('code' in value) ||
      typeof value.code !== 'string' ||
      !('dependencies' in value) ||
      !Array.isArray(value.dependencies) ||
      value.dependencies.some(
        dependency =>
          typeof dependency.specifier !== 'string' ||
          (dependency.kind !== 'require' && dependency.kind !== 'import')
      )
    ) {
      throw new Error('Transpile service returned invalid output.');
    }
    return { code: value.code, dependencies: value.dependencies };
  }
}
