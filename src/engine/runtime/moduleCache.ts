/**
 * [NEW ARCHITECTURE] Module Cache Manager
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { runtimeInfo, runtimeWarn, runtimeError } from '@/engine/runtime/runtimeLogger';
export interface CacheEntry {
  originalPath: string;
  hash: string;
  code: string;
  sourceMap?: string;
  deps: string[];
  mtime: number;
  lastAccess: number;
  size: number;
}

export class ModuleCache {
  private projectId: string;
  private projectName: string;
  private cache: Map<string, CacheEntry> = new Map();
  private maxCacheSize: number = 100 * 1024 * 1024;
  private cacheDir = '/cache/modules';
  private metaDir = '/cache/meta';
  private initialized = false;

  constructor(projectId: string, projectName: string) {
    this.projectId = projectId;
    this.projectName = projectName;
  }
  async init(): Promise<void> {
    if (this.initialized) return;

    runtimeInfo('🗄️ Initializing module cache...');
    await this.ensureCacheDirectories();
    await this.loadAllCacheFromDisk();
    this.initialized = true;

    runtimeInfo('✅ Module cache initialized:', {
      entries: this.cache.size,
      totalSize: this.formatSize(this.getTotalSize()),
    });
  }

  async get(path: string, version?: string): Promise<CacheEntry | null> {
    const hash = this.hashPath(path, version);
    const entry = this.cache.get(hash);

    if (entry) {
      entry.lastAccess = Date.now();
      runtimeInfo('✅ Cache HIT:', path);
      return entry;
    }

    runtimeWarn('❌ Cache MISS:', path);
    return null;
  }

  async set(
    path: string,
    entry: Omit<CacheEntry, 'hash' | 'lastAccess'>,
    version?: string
  ): Promise<void> {
    const hash = this.hashPath(path, version);
    const cacheEntry: CacheEntry = { ...entry, hash, lastAccess: Date.now() };

    this.cache.set(hash, cacheEntry);
    runtimeInfo('💾 Saving cache:', path, `(${this.formatSize(entry.size)})`);

    try {
      await this.saveToDisk(hash, cacheEntry);
      runtimeInfo('✅ Cache saved:', path);
    } catch (error) {
      runtimeError('❌ Failed to save cache:', error);
      this.cache.delete(hash);
      throw error;
    }

    await this.checkCacheSize();
  }

  async clear(): Promise<void> {
    this.cache.clear();
    runtimeInfo('✅ Cache cleared');
  }

  private async ensureCacheDirectories(): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);

      if (!files.some(f => f.path === this.cacheDir)) {
        await fileRepository.createFile(this.projectId, this.cacheDir, '', 'folder');
        runtimeInfo('📁 Created:', this.cacheDir);
      }

      if (!files.some(f => f.path === this.metaDir)) {
        await fileRepository.createFile(this.projectId, this.metaDir, '', 'folder');
        runtimeInfo('📁 Created:', this.metaDir);
      }
    } catch (error) {
      runtimeWarn('⚠️ Failed to create cache directories:', error);
    }
  }

  private async loadAllCacheFromDisk(): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const metaFiles = files.filter(
        f =>
          f.path.startsWith(this.metaDir) &&
          f.path.endsWith('.json') &&
          f.type === 'file' &&
          f.content?.trim()
      );

      runtimeInfo(`📂 Found ${metaFiles.length} cache meta files`);
      let loadedCount = 0;

      for (const metaFile of metaFiles) {
        try {
          const meta: any = JSON.parse(metaFile.content);
          const hash = metaFile.name.replace('.json', '');
          const codeFile = files.find(f => f.path === `${this.cacheDir}/${hash}.js`);

          if (codeFile?.content) {
            const entry: CacheEntry = {
              originalPath: meta.originalPath,
              hash: meta.hash || hash,
              code: codeFile.content,
              sourceMap: meta.sourceMap,
              deps: meta.deps || [],
              mtime: meta.mtime || Date.now(),
              lastAccess: meta.lastAccess || Date.now(),
              size: meta.size || codeFile.content.length,
            };
            this.cache.set(entry.hash, entry);
            loadedCount++;
          }
        } catch (error) {
          runtimeWarn('⚠️ Failed to parse:', metaFile.path);
        }
      }

      runtimeInfo(`✅ Loaded ${loadedCount} cache entries`);
    } catch (error) {
      runtimeWarn('⚠️ Failed to load cache:', error);
    }
  }

  private async saveToDisk(hash: string, entry: CacheEntry): Promise<void> {
    await fileRepository.createFile(
      this.projectId,
      `${this.cacheDir}/${hash}.js`,
      entry.code,
      'file'
    );

    const meta: Omit<CacheEntry, 'code'> = {
      originalPath: entry.originalPath,
      hash: entry.hash,
      sourceMap: entry.sourceMap,
      deps: entry.deps,
      mtime: entry.mtime,
      lastAccess: entry.lastAccess,
      size: entry.size,
    };

    await fileRepository.createFile(
      this.projectId,
      `${this.metaDir}/${hash}.json`,
      JSON.stringify(meta, null, 2),
      'file'
    );
  }

  private async checkCacheSize(): Promise<void> {
    const totalSize = this.getTotalSize();
    if (totalSize > this.maxCacheSize) {
      runtimeInfo(`🗑️ Cache size exceeded (${this.formatSize(totalSize)}), running GC...`);
      await this.runGC();
    }
  }

  private async runGC(): Promise<void> {
    const beforeSize = this.getTotalSize();
    const entries = Array.from(this.cache.values()).sort((a, b) => a.lastAccess - b.lastAccess);

    let currentSize = beforeSize;
    const targetSize = this.maxCacheSize * 0.7;
    let deletedCount = 0;

    for (const entry of entries) {
      if (currentSize <= targetSize) break;

      this.cache.delete(entry.hash);
      try {
        await this.deleteFromDisk(entry.hash);
        currentSize -= entry.size;
        deletedCount++;
      } catch (error) {
        runtimeWarn('⚠️ Failed to delete:', entry.hash);
      }
    }
    runtimeInfo('✅ GC completed:', {
      deleted: deletedCount,
      before: this.formatSize(beforeSize),
      after: this.formatSize(this.getTotalSize()),
    });
  }

  private async deleteFromDisk(hash: string): Promise<void> {
    const files = await fileRepository.getProjectFiles(this.projectId);

    const codeFile = files.find(f => f.path === `${this.cacheDir}/${hash}.js`);
    if (codeFile) await fileRepository.deleteFile(codeFile.id);

    const metaFile = files.find(f => f.path === `${this.metaDir}/${hash}.json`);
    if (metaFile) await fileRepository.deleteFile(metaFile.id);
  }

  private getTotalSize(): number {
    return Array.from(this.cache.values()).reduce((sum, entry) => sum + entry.size, 0);
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
  }

  /**
   * Compute a hash for cache keys. If version is provided, include it so that
   * the same path with different content/version produces different keys.
   */
  private hashPath(path: string, version?: string): string {
    const input = version ? `${path}|${version}` : path;
    let hash = 0;
    for (let i = 0; i < input.length; i++) {
      const char = input.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }
}
