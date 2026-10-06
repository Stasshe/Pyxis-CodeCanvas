import { RUNTIME_CACHE_PATH } from '@/engine/core/fs/layout';
import { resolvePath } from '@/engine/core/pathUtils';
import type { ModuleFileSystem } from './moduleFileSystem';

export interface CacheEntry {
  contentHash: string;
  code: string;
  deps: string[];
}

interface CacheMetadata {
  contentHash: string;
  deps: string[];
}

export class ModuleCache {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly codeDirectory = resolvePath(RUNTIME_CACHE_PATH, 'modules');
  private readonly metadataDirectory = resolvePath(RUNTIME_CACHE_PATH, 'meta');

  constructor(private readonly fileSystem: ModuleFileSystem) {}

  async init(): Promise<void> {
    await this.fileSystem.mkdir(this.codeDirectory);
    await this.fileSystem.mkdir(this.metadataDirectory);
  }

  async get(path: string, contentHash: string): Promise<CacheEntry | null> {
    const cached = this.entries.get(path);
    if (cached) {
      if (cached.contentHash === contentHash) return cached;
      this.entries.delete(path);
      await this.delete(path);
      return null;
    }

    const name = await this.pathKey(path);
    const metadataText = await this.fileSystem.readOptionalFile(
      `${this.metadataDirectory}/${name}.json`
    );
    if (metadataText === null) return null;
    const metadata: CacheMetadata = JSON.parse(metadataText) as CacheMetadata;
    if (metadata.contentHash !== contentHash) {
      await this.delete(path);
      return null;
    }

    const code = await this.fileSystem.readOptionalFile(`${this.codeDirectory}/${name}.js`);
    if (code === null) return null;
    const entry = { contentHash, code, deps: metadata.deps };
    this.entries.set(path, entry);
    return entry;
  }

  async set(path: string, entry: CacheEntry): Promise<void> {
    const name = await this.pathKey(path);
    await this.fileSystem.writeFile(`${this.codeDirectory}/${name}.js`, entry.code);
    const metadata: CacheMetadata = { contentHash: entry.contentHash, deps: entry.deps };
    await this.fileSystem.writeFile(
      `${this.metadataDirectory}/${name}.json`,
      JSON.stringify(metadata)
    );
    this.entries.set(path, entry);
  }

  clear(): void {
    this.entries.clear();
  }

  private async delete(path: string): Promise<void> {
    const name = await this.pathKey(path);
    await this.fileSystem.rm(`${this.codeDirectory}/${name}.js`);
    await this.fileSystem.rm(`${this.metadataDirectory}/${name}.json`);
  }

  private async pathKey(path: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(path));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }
}
