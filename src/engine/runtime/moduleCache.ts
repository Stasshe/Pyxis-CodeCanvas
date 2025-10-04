/**
 * [NEW ARCHITECTURE] Module Cache Manager
 *
 * ## 役割
 * - トランスパイル済みモジュールのキャッシュ管理
 * - LRU戦略によるメモリ管理
 * - IndexedDB (fileRepository) への永続化
 */

import { fileRepository } from '@/engine/core/fileRepository';

/**
 * キャッシュエントリ
 */
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

/**
 * キャッシュメタデータ
 */
interface CacheMeta {
  totalSize: number;
  entries: Map<string, CacheEntry>;
}

/**
 * Module Cache Manager
 */
export class ModuleCache {
  private projectId: string;
  private projectName: string;
  private cache: Map<string, CacheEntry> = new Map();
  private maxCacheSize: number = 100 * 1024 * 1024; // 100MB
  private cacheDir = '/cache/modules';
  private metaDir = '/cache/meta';

  constructor(projectId: string, projectName: string) {
    this.projectId = projectId;
    this.projectName = projectName;
  }

  /**
   * キャッシュを初期化
   */
  async init(): Promise<void> {
    console.log('🗄️ Initializing module cache...');

    // キャッシュディレクトリを作成
    await this.ensureCacheDirectories();

    // メタデータを読み込み
    await this.loadMetadata();

    console.log('✅ Module cache initialized:', {
      entries: this.cache.size,
      totalSize: this.getTotalSize(),
    });
  }

  /**
   * キャッシュからエントリを取得
   */
  async get(path: string): Promise<CacheEntry | null> {
    const hash = this.hashPath(path);
    let entry = this.cache.get(hash);

    if (entry) {
      // メモリキャッシュヒット
      entry.lastAccess = Date.now();
      return entry;
    }

    // ディスクから読み込み
    const diskEntry = await this.loadFromDisk(hash);
    if (diskEntry) {
      diskEntry.lastAccess = Date.now();
      this.cache.set(hash, diskEntry);
      return diskEntry;
    }

    return null;
  }

  /**
   * キャッシュにエントリを保存
   */
  async set(path: string, entry: Omit<CacheEntry, 'hash' | 'lastAccess'>): Promise<void> {
    const hash = this.hashPath(path);
    const cacheEntry: CacheEntry = {
      ...entry,
      hash,
      lastAccess: Date.now(),
    };

    // メモリキャッシュに保存
    this.cache.set(hash, cacheEntry);

    // ディスクに永続化（非同期・バックグラウンド）
    this.saveToDisk(hash, cacheEntry).catch((error) => {
      console.error('❌ Failed to save cache to disk:', error);
    });

    // キャッシュサイズをチェック
    await this.checkCacheSize();
  }

  /**
   * キャッシュをクリア
   */
  async clear(): Promise<void> {
    this.cache.clear();
    console.log('✅ Cache cleared');
  }

  /**
   * キャッシュディレクトリを確保
   */
  private async ensureCacheDirectories(): Promise<void> {
    try {
      // キャッシュディレクトリを作成（すでに存在する場合は無視）
      await fileRepository.createFile(
        this.projectId,
        this.cacheDir,
        '',
        'folder'
      ).catch(() => {/* すでに存在 */});

      await fileRepository.createFile(
        this.projectId,
        this.metaDir,
        '',
        'folder'
      ).catch(() => {/* すでに存在 */});
    } catch (error) {
      console.warn('⚠️ Failed to create cache directories:', error);
    }
  }

  /**
   * メタデータを読み込み
   */
  private async loadMetadata(): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);
      const metaFiles = files.filter((f) => f.path.startsWith(this.metaDir));

      for (const file of metaFiles) {
        try {
          const meta: CacheEntry = JSON.parse(file.content);
          this.cache.set(meta.hash, meta);
        } catch (error) {
          console.warn('⚠️ Failed to parse cache meta:', file.path);
        }
      }
    } catch (error) {
      console.warn('⚠️ Failed to load cache metadata:', error);
    }
  }

  /**
   * ディスクからエントリを読み込み
   */
  private async loadFromDisk(hash: string): Promise<CacheEntry | null> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);

      // コードファイルを読み込み
      const codeFile = files.find((f) => f.path === `${this.cacheDir}/${hash}.js`);
      if (!codeFile) {
        return null;
      }

      // メタファイルを読み込み
      const metaFile = files.find((f) => f.path === `${this.metaDir}/${hash}.json`);
      if (!metaFile) {
        return null;
      }

      const meta: CacheEntry = JSON.parse(metaFile.content);
      meta.code = codeFile.content;

      return meta;
    } catch (error) {
      console.warn('⚠️ Failed to load cache from disk:', hash, error);
      return null;
    }
  }

  /**
   * ディスクにエントリを保存
   */
  private async saveToDisk(hash: string, entry: CacheEntry): Promise<void> {
    try {
      // コードファイルを保存
      await fileRepository.createFile(
        this.projectId,
        `${this.cacheDir}/${hash}.js`,
        entry.code,
        'file'
      );

      // メタファイルを保存（コードは除外）
      const meta = { ...entry };
      delete (meta as any).code;

      await fileRepository.createFile(
        this.projectId,
        `${this.metaDir}/${hash}.json`,
        JSON.stringify(meta, null, 2),
        'file'
      );
    } catch (error) {
      console.error('❌ Failed to save cache to disk:', error);
    }
  }

  /**
   * キャッシュサイズをチェックしてGC
   */
  private async checkCacheSize(): Promise<void> {
    const totalSize = this.getTotalSize();

    if (totalSize > this.maxCacheSize) {
      console.log('🗑️ Cache size exceeded, running GC...');
      await this.runGC();
    }
  }

  /**
   * GC（古いエントリを削除）
   */
  private async runGC(): Promise<void> {
    // lastAccess でソート
    const entries = Array.from(this.cache.values()).sort(
      (a, b) => a.lastAccess - b.lastAccess
    );

    let currentSize = this.getTotalSize();
    const targetSize = this.maxCacheSize * 0.7; // 70%まで削減

    for (const entry of entries) {
      if (currentSize <= targetSize) {
        break;
      }

      // メモリから削除
      this.cache.delete(entry.hash);

      // ディスクから削除
      await this.deleteFromDisk(entry.hash);

      currentSize -= entry.size;
    }

    console.log('✅ GC completed:', {
      before: this.getTotalSize(),
      after: currentSize,
    });
  }

  /**
   * ディスクからエントリを削除
   */
  private async deleteFromDisk(hash: string): Promise<void> {
    try {
      const files = await fileRepository.getProjectFiles(this.projectId);

      // コードファイルを削除
      const codeFile = files.find((f) => f.path === `${this.cacheDir}/${hash}.js`);
      if (codeFile) {
        await fileRepository.deleteFile(codeFile.id);
      }

      // メタファイルを削除
      const metaFile = files.find((f) => f.path === `${this.metaDir}/${hash}.json`);
      if (metaFile) {
        await fileRepository.deleteFile(metaFile.id);
      }
    } catch (error) {
      console.warn('⚠️ Failed to delete cache from disk:', hash, error);
    }
  }

  /**
   * 総キャッシュサイズを取得
   */
  private getTotalSize(): number {
    return Array.from(this.cache.values()).reduce(
      (sum, entry) => sum + entry.size,
      0
    );
  }

  /**
   * パスをハッシュ化
   */
  private hashPath(path: string): string {
    // シンプルなハッシュ関数（本番環境ではcrypto.subtle.digestを使用推奨）
    let hash = 0;
    for (let i = 0; i < path.length; i++) {
      const char = path.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return Math.abs(hash).toString(36);
  }
}
