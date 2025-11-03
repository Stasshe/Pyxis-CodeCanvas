/**
 * Pyxis Global Storage Layer
 * IndexedDBを使用した汎用的なデータ永続化とキャッシュ管理
 *
 * 使用例:
 * ```typescript
 * import { storageService } from '@/engine/storage';
 *
 * // データの保存
 * await storageService.set('translations', 'en-common', { hello: 'Hello' });
 *
 * // データの取得（自動キャッシュ）
 * const data = await storageService.get('translations', 'en-common');
 *
 * // データの削除
 * await storageService.delete('translations', 'en-common');
 * ```
 */

const DB_NAME = 'pyxis-global';
const DB_VERSION = 2; // extensionsストア追加のためバージョンアップ

/**
 * ストアの定義
 * 新しいストアを追加する場合は、ここに追加してください
 */
export const STORES = {
  TRANSLATIONS: 'translations', // i18n翻訳データ
  KEYBINDINGS: 'keybindings', // ショートカットキー設定
  USER_PREFERENCES: 'user_preferences', // ユーザー設定
  EXTENSIONS: 'extensions', // 拡張機能データ
  TAB_STATE: 'tab_state', // タブ・ペイン状態
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

/**
 * ストレージエントリの基本型
 */
export interface StorageEntry<T = unknown> {
  id: string;
  data: T;
  timestamp: number;
  expiresAt?: number; // オプション：有効期限（ミリ秒）
}

/**
 * ストレージオプション
 */
export interface StorageOptions {
  /** キャッシュの有効期限（ミリ秒）。指定しない場合は無期限 */
  ttl?: number;
}

/**
 * インメモリキャッシュ
 */
class MemoryCache {
  private cache = new Map<string, { data: unknown; timestamp: number; expiresAt?: number }>();

  get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    // 有効期限チェック
    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.data as T;
  }

  set<T>(key: string, data: T, expiresAt?: number): void {
    this.cache.set(key, { data, timestamp: Date.now(), expiresAt });
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  has(key: string): boolean {
    const entry = this.cache.get(key);
    if (!entry) return false;

    if (entry.expiresAt && Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }
}

/**
 * IndexedDB管理クラス
 */
class PyxisStorage {
  private db: IDBDatabase | null = null;
  private initPromise: Promise<IDBDatabase> | null = null;
  private cache = new MemoryCache();

  /**
   * IndexedDBの初期化
   */
  private async init(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    if (this.initPromise) return this.initPromise;

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        console.error('[PyxisStorage] Failed to open database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };

      request.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;
        const oldVersion = event.oldVersion;

        // 各ストアを作成
        for (const storeName of Object.values(STORES)) {
          if (!db.objectStoreNames.contains(storeName)) {
            const store = db.createObjectStore(storeName, { keyPath: 'id' });
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('expiresAt', 'expiresAt', { unique: false });
            console.log(`[PyxisStorage] Created store: ${storeName}`);
          }
        }

        console.log(`[PyxisStorage] Database upgraded from version ${oldVersion} to ${DB_VERSION}`);
      };
    });

    return this.initPromise;
  }

  /**
   * キャッシュキーの生成
   */
  private getCacheKey(storeName: StoreName, id: string): string {
    return `${storeName}:${id}`;
  }

  /**
   * データの保存
   * @param storeName ストア名
   * @param id データのID
   * @param data 保存するデータ
   * @param options オプション（TTL等）
   */
  async set<T>(storeName: StoreName, id: string, data: T, options?: StorageOptions): Promise<void> {
    try {
      const db = await this.init();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      const timestamp = Date.now();
      const expiresAt = options?.ttl ? timestamp + options.ttl : undefined;

      const entry: StorageEntry<T> = {
        id,
        data,
        timestamp,
        expiresAt,
      };

      await new Promise<void>((resolve, reject) => {
        const request = store.put(entry);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      // メモリキャッシュにも保存
      const cacheKey = this.getCacheKey(storeName, id);
      this.cache.set(cacheKey, data, expiresAt);

      console.log(`[PyxisStorage] Saved: ${storeName}/${id}`);
    } catch (error) {
      console.error(`[PyxisStorage] Failed to save ${storeName}/${id}:`, error);
      throw error;
    }
  }

  /**
   * データの取得
   * @param storeName ストア名
   * @param id データのID
   * @returns データ、存在しないか期限切れの場合はnull
   */
  async get<T>(storeName: StoreName, id: string): Promise<T | null> {
    // メモリキャッシュから取得を試みる
    const cacheKey = this.getCacheKey(storeName, id);
    const cached = this.cache.get<T>(cacheKey);
    if (cached !== null) {
      console.log(`[PyxisStorage] Cache hit: ${storeName}/${id}`);
      return cached;
    }

    try {
      const db = await this.init();
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      const entry = await new Promise<StorageEntry<T> | undefined>((resolve, reject) => {
        const request = store.get(id);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      if (!entry) {
        console.log(`[PyxisStorage] Not found: ${storeName}/${id}`);
        return null;
      }

      // 有効期限チェック
      if (entry.expiresAt && Date.now() > entry.expiresAt) {
        console.log(`[PyxisStorage] Expired: ${storeName}/${id}`);
        await this.delete(storeName, id);
        return null;
      }

      // メモリキャッシュに保存
      this.cache.set(cacheKey, entry.data, entry.expiresAt);

      console.log(`[PyxisStorage] Loaded: ${storeName}/${id}`);
      return entry.data;
    } catch (error) {
      console.error(`[PyxisStorage] Failed to load ${storeName}/${id}:`, error);
      return null;
    }
  }

  /**
   * データの削除
   * @param storeName ストア名
   * @param id データのID
   */
  async delete(storeName: StoreName, id: string): Promise<void> {
    try {
      const db = await this.init();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      await new Promise<void>((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      // メモリキャッシュからも削除
      const cacheKey = this.getCacheKey(storeName, id);
      this.cache.delete(cacheKey);

      console.log(`[PyxisStorage] Deleted: ${storeName}/${id}`);
    } catch (error) {
      console.error(`[PyxisStorage] Failed to delete ${storeName}/${id}:`, error);
      throw error;
    }
  }

  /**
   * ストア内の全データを取得
   * @param storeName ストア名
   * @returns データのリスト
   */
  async getAll<T>(storeName: StoreName): Promise<Array<StorageEntry<T>>> {
    try {
      const db = await this.init();
      const tx = db.transaction(storeName, 'readonly');
      const store = tx.objectStore(storeName);

      const entries = await new Promise<Array<StorageEntry<T>>>((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });

      // 有効期限チェック
      const now = Date.now();
      return entries.filter(entry => {
        if (entry.expiresAt && now > entry.expiresAt) {
          // 期限切れのエントリは削除（非同期で実行）
          this.delete(storeName, entry.id).catch(console.error);
          return false;
        }
        return true;
      });
    } catch (error) {
      console.error(`[PyxisStorage] Failed to get all from ${storeName}:`, error);
      return [];
    }
  }

  /**
   * ストアをクリア
   * @param storeName ストア名
   */
  async clear(storeName: StoreName): Promise<void> {
    try {
      const db = await this.init();
      const tx = db.transaction(storeName, 'readwrite');
      const store = tx.objectStore(storeName);

      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });

      // メモリキャッシュもクリア（該当ストアのみ）
      const prefix = `${storeName}:`;
      this.cache.clear(); // 簡易的に全体をクリア

      console.log(`[PyxisStorage] Cleared store: ${storeName}`);
    } catch (error) {
      console.error(`[PyxisStorage] Failed to clear ${storeName}:`, error);
      throw error;
    }
  }

  /**
   * 全ストアをクリア
   */
  async clearAll(): Promise<void> {
    try {
      for (const storeName of Object.values(STORES)) {
        await this.clear(storeName);
      }
      this.cache.clear();
      console.log('[PyxisStorage] Cleared all stores');
    } catch (error) {
      console.error('[PyxisStorage] Failed to clear all stores:', error);
      throw error;
    }
  }

  /**
   * 期限切れデータの一括削除（メンテナンス用）
   */
  async cleanExpired(): Promise<void> {
    try {
      const db = await this.init();
      const now = Date.now();
      let totalCleaned = 0;

      for (const storeName of Object.values(STORES)) {
        const tx = db.transaction(storeName, 'readwrite');
        const store = tx.objectStore(storeName);
        const index = store.index('expiresAt');

        const expiredIds: string[] = [];

        await new Promise<void>((resolve, reject) => {
          const request = index.openCursor();

          request.onsuccess = event => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
              const entry = cursor.value as StorageEntry;
              if (entry.expiresAt && now > entry.expiresAt) {
                expiredIds.push(entry.id);
              }
              cursor.continue();
            } else {
              resolve();
            }
          };

          request.onerror = () => reject(request.error);
        });

        // 期限切れのエントリを削除
        for (const id of expiredIds) {
          await new Promise<void>((resolve, reject) => {
            const deleteRequest = store.delete(id);
            deleteRequest.onsuccess = () => resolve();
            deleteRequest.onerror = () => reject(deleteRequest.error);
          });
        }

        totalCleaned += expiredIds.length;
      }

      if (totalCleaned > 0) {
        console.log(`[PyxisStorage] Cleaned ${totalCleaned} expired entries`);
      }
    } catch (error) {
      console.error('[PyxisStorage] Failed to clean expired data:', error);
    }
  }

  /**
   * データベースのクローズ
   */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.initPromise = null;
      console.log('[PyxisStorage] Database closed');
    }
  }
}

/**
 * グローバルストレージインスタンス
 */
export const storageService = new PyxisStorage();

// アプリケーション起動時に期限切れデータをクリーンアップ
if (typeof window !== 'undefined') {
  storageService.cleanExpired().catch(console.error);
}
