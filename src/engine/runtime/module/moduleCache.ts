/**
 * [NEW ARCHITECTURE] Module Cache Manager
 *
 * キャッシュ戦略:
 * - キャッシュキーはファイルパスのみ(内容のハッシュは含めない)
 * - ファイル内容のハッシュはmetaに保存し、変更検出に使用
 * - 依存グラフを双方向管理(A→B と B←A)
 * - ファイル変更時:
 *   1. 変更されたファイル自体のキャッシュを削除
 *   2. そのファイルに依存する全ファイルのキャッシュも無効化
 *   3. 変更されていない依存ファイルはキャッシュ利用可能
 */

import type { FileRepository } from '@/engine/core/fileRepository';
import { fileRepository as defaultFileRepository } from '@/engine/core/fileRepository';
import { runtimeError, runtimeInfo, runtimeWarn } from '@/engine/runtime/core/runtimeLogger';

export interface CacheEntry {
  originalPath: string;
  contentHash: string; // ファイル内容のハッシュ(変更検出用)
  code: string;
  sourceMap?: string;
  deps: string[]; // このファイルが依存しているファイル一覧
  dependents: string[]; // このファイルに依存しているファイル一覧(逆参照)
  mtime: number;
  lastAccess: number;
  size: number;
}

export class ModuleCache {
  private projectId: string;
  private projectName: string;
  private cache: Map<string, CacheEntry> = new Map(); // key = originalPath
  private maxCacheSize: number = 100 * 1024 * 1024;
  private cacheDir = '/cache/modules';
  private metaDir = '/cache/meta';
  private initialized = false;
  private fileRepository: FileRepository;

  constructor(projectId: string, projectName: string, options?: { fileRepository?: FileRepository }) {
    this.projectId = projectId;
    this.projectName = projectName;
    this.fileRepository = options?.fileRepository ?? defaultFileRepository;
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

  /**
   * キャッシュを取得(内容ハッシュで検証)
   * @param path ファイルパス
   * @param currentContentHash 現在のファイル内容のハッシュ(変更検出用)
   */
  async get(path: string, currentContentHash?: string): Promise<CacheEntry | null> {
    const entry = this.cache.get(path);

    if (entry) {
      // 内容ハッシュが変わっていたらキャッシュ無効
      if (currentContentHash && entry.contentHash !== currentContentHash) {
        runtimeWarn('⚠️ Cache INVALID (content changed):', path);
        await this.invalidate(path);
        return null;
      }

      entry.lastAccess = Date.now();
      runtimeInfo('✅ Cache HIT:', path);
      return entry;
    }

    runtimeWarn('❌ Cache MISS:', path);
    return null;
  }

  /**
   * キャッシュを保存
   * @param path ファイルパス
   * @param entry キャッシュエントリ(contentHash, deps含む)
   */
  async set(path: string, entry: Omit<CacheEntry, 'dependents' | 'lastAccess'>): Promise<void> {
    // 既存キャッシュがあれば依存グラフから削除
    const oldEntry = this.cache.get(path);
    if (oldEntry) {
      await this.removeDependencyLinks(path, oldEntry.deps);
    }

    // 新しいキャッシュエントリ
    const cacheEntry: CacheEntry = {
      ...entry,
      dependents: [],
      lastAccess: Date.now(),
    };

    this.cache.set(path, cacheEntry);
    runtimeInfo('💾 Saving cache:', path, `(${this.formatSize(entry.size)})`);

    // 依存グラフを更新(双方向リンク)
    await this.updateDependencyLinks(path, entry.deps);

    try {
      await this.saveToDisk(path, cacheEntry);
      runtimeInfo('✅ Cache saved:', path);
    } catch (error) {
      runtimeError('❌ Failed to save cache:', error);
      this.cache.delete(path);
      throw error;
    }

    await this.checkCacheSize();
  }

  /**
   * 指定ファイルとそれに依存する全ファイルのキャッシュを無効化
   * @param path 変更されたファイルのパス
   */
  async invalidate(path: string): Promise<void> {
    const entry = this.cache.get(path);
    if (!entry) return;

    runtimeInfo('🗑️ Invalidating cache:', path);

    // このファイルに依存している全ファイルも無効化(再帰的)
    const dependents = [...entry.dependents];
    for (const dependent of dependents) {
      await this.invalidate(dependent);
    }

    // 依存グラフから削除
    await this.removeDependencyLinks(path, entry.deps);

    // キャッシュとディスクから削除
    this.cache.delete(path);
    await this.deleteFromDisk(path);
  }

  /**
   * 依存グラフに双方向リンクを追加
   */
  private async updateDependencyLinks(path: string, deps: string[]): Promise<void> {
    for (const dep of deps) {
      const depEntry = this.cache.get(dep);
      if (depEntry && !depEntry.dependents.includes(path)) {
        depEntry.dependents.push(path);
      }
    }
  }

  /**
   * 依存グラフから双方向リンクを削除
   */
  private async removeDependencyLinks(path: string, deps: string[]): Promise<void> {
    for (const dep of deps) {
      const depEntry = this.cache.get(dep);
      if (depEntry) {
        depEntry.dependents = depEntry.dependents.filter(d => d !== path);
      }
    }
  }

  async clear(): Promise<void> {
    this.cache.clear();
    runtimeInfo('✅ Cache cleared');
  }

  private async ensureCacheDirectories(): Promise<void> {
    try {
      await this.fileRepository.init();
      const cacheDirFile = await this.fileRepository.getFileByPath(this.projectId, this.cacheDir);
      if (!cacheDirFile) {
        await this.fileRepository.createFile(this.projectId, this.cacheDir, '', 'folder');
        runtimeInfo('📁 Created:', this.cacheDir);
      }

      const metaDirFile = await this.fileRepository.getFileByPath(this.projectId, this.metaDir);
      if (!metaDirFile) {
        await this.fileRepository.createFile(this.projectId, this.metaDir, '', 'folder');
        runtimeInfo('📁 Created:', this.metaDir);
      }
    } catch (error) {
      runtimeWarn('⚠️ Failed to create cache directories:', error);
    }
  }

  private async loadAllCacheFromDisk(): Promise<void> {
    try {
      await this.fileRepository.init();
      const metaFiles = await this.fileRepository.getFilesByPrefix(this.projectId, this.metaDir);
      const filteredMetaFiles = metaFiles.filter(
        f => f.path.endsWith('.json') && f.type === 'file' && f.content?.trim()
      );

      runtimeInfo(`📂 Found ${metaFiles.length} cache meta files`);
      let loadedCount = 0;

      for (const metaFile of filteredMetaFiles) {
        try {
          const meta: any = JSON.parse(metaFile.content);
          const originalPath = meta.originalPath;
          const safeFileName = this.pathToSafeFileName(originalPath);
          const codeFile = await this.fileRepository.getFileByPath(
            this.projectId,
            `${this.cacheDir}/${safeFileName}.js`
          );

          if (codeFile?.content && originalPath) {
            const entry: CacheEntry = {
              originalPath,
              contentHash: meta.contentHash || '',
              code: codeFile.content,
              sourceMap: meta.sourceMap,
              deps: meta.deps || [],
              dependents: meta.dependents || [],
              mtime: meta.mtime || Date.now(),
              lastAccess: meta.lastAccess || Date.now(),
              size: meta.size || codeFile.content.length,
            };
            this.cache.set(originalPath, entry);
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

  private async saveToDisk(path: string, entry: CacheEntry): Promise<void> {
    const safeFileName = this.pathToSafeFileName(path);

    await this.fileRepository.createFile(
      this.projectId,
      `${this.cacheDir}/${safeFileName}.js`,
      entry.code,
      'file'
    );

    const meta: Omit<CacheEntry, 'code'> = {
      originalPath: entry.originalPath,
      contentHash: entry.contentHash,
      sourceMap: entry.sourceMap,
      deps: entry.deps,
      dependents: entry.dependents,
      mtime: entry.mtime,
      lastAccess: entry.lastAccess,
      size: entry.size,
    };

    await this.fileRepository.createFile(
      this.projectId,
      `${this.metaDir}/${safeFileName}.json`,
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
    const entries = Array.from(this.cache.entries())
      .map(([path, entry]) => ({ path, entry }))
      .sort((a, b) => a.entry.lastAccess - b.entry.lastAccess);

    let currentSize = beforeSize;
    const targetSize = this.maxCacheSize * 0.7;
    let deletedCount = 0;

    for (const { path, entry } of entries) {
      if (currentSize <= targetSize) break;

      // 依存グラフから削除
      await this.removeDependencyLinks(path, entry.deps);
      this.cache.delete(path);

      try {
        await this.deleteFromDisk(path);
        currentSize -= entry.size;
        deletedCount++;
      } catch (error) {
        runtimeWarn('⚠️ Failed to delete:', path);
      }
    }
    runtimeInfo('✅ GC completed:', {
      deleted: deletedCount,
      before: this.formatSize(beforeSize),
      after: this.formatSize(this.getTotalSize()),
    });
  }

  private async deleteFromDisk(path: string): Promise<void> {
    const safeFileName = this.pathToSafeFileName(path);
    const codeFile = await this.fileRepository.getFileByPath(
      this.projectId,
      `${this.cacheDir}/${safeFileName}.js`
    );
    if (codeFile) await this.fileRepository.deleteFile(codeFile.id);

    const metaFile = await this.fileRepository.getFileByPath(
      this.projectId,
      `${this.metaDir}/${safeFileName}.json`
    );
    if (metaFile) await this.fileRepository.deleteFile(metaFile.id);
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
   * ファイル内容のハッシュを計算(変更検出用)
   */
  hashContent(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  /**
   * ファイルパスを安全なファイル名に変換
   * 例: /src/app.tsx → _src_app.tsx
   */
  private pathToSafeFileName(path: string): string {
    return path.replace(/[^a-zA-Z0-9.]/g, '_');
  }
}
