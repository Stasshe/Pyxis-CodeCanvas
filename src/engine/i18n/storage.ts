/**
 * i18n Storage Layer
 * IndexedDBを使用した翻訳データの永続化とキャッシュ管理
 */

import type { Locale, TranslationCacheEntry } from './types';

const DB_NAME = 'pyxis-i18n';
const DB_VERSION = 1;
const STORE_NAME = 'translations';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7日間

/**
 * IndexedDBの初期化
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // translationsストアを作成
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex('locale', 'locale', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * 翻訳データをIndexedDBに保存
 */
export async function saveTranslationCache(
  locale: Locale,
  namespace: string,
  data: Record<string, unknown>
): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    const entry: TranslationCacheEntry & { id: string } = {
      id: `${locale}-${namespace}`,
      locale,
      namespace,
      data,
      timestamp: Date.now(),
    };

    await new Promise<void>((resolve, reject) => {
      const request = store.put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
  } catch (error) {
    console.error('[i18n-storage] Failed to save cache:', error);
  }
}

/**
 * IndexedDBから翻訳データを取得
 */
export async function loadTranslationCache(
  locale: Locale,
  namespace: string
): Promise<Record<string, unknown> | null> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);

    const entry = await new Promise<(TranslationCacheEntry & { id: string }) | undefined>(
      (resolve, reject) => {
        const request = store.get(`${locale}-${namespace}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }
    );

    db.close();

    if (!entry) return null;

    // キャッシュの有効期限チェック
    const isExpired = Date.now() - entry.timestamp > CACHE_EXPIRY_MS;
    if (isExpired) {
      await deleteTranslationCache(locale, namespace);
      return null;
    }

    return entry.data;
  } catch (error) {
    console.error('[i18n-storage] Failed to load cache:', error);
    return null;
  }
}

/**
 * 翻訳キャッシュを削除
 */
export async function deleteTranslationCache(locale: Locale, namespace: string): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.delete(`${locale}-${namespace}`);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
  } catch (error) {
    console.error('[i18n-storage] Failed to delete cache:', error);
  }
}

/**
 * 全ての翻訳キャッシュをクリア
 */
export async function clearAllTranslationCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);

    await new Promise<void>((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });

    db.close();
    console.log('[i18n-storage] All caches cleared');
  } catch (error) {
    console.error('[i18n-storage] Failed to clear all caches:', error);
  }
}

/**
 * 古いキャッシュを削除（メンテナンス用）
 */
export async function cleanExpiredCache(): Promise<void> {
  try {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const index = store.index('timestamp');

    const expiredEntries: string[] = [];
    const now = Date.now();

    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor();

      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (cursor) {
          const entry = cursor.value as TranslationCacheEntry & { id: string };
          if (now - entry.timestamp > CACHE_EXPIRY_MS) {
            expiredEntries.push(entry.id);
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      request.onerror = () => reject(request.error);
    });

    // 期限切れのエントリを削除
    for (const id of expiredEntries) {
      await new Promise<void>((resolve, reject) => {
        const deleteRequest = store.delete(id);
        deleteRequest.onsuccess = () => resolve();
        deleteRequest.onerror = () => reject(deleteRequest.error);
      });
    }

    db.close();

    if (expiredEntries.length > 0) {
      console.log(`[i18n-storage] Cleaned ${expiredEntries.length} expired entries`);
    }
  } catch (error) {
    console.error('[i18n-storage] Failed to clean expired cache:', error);
  }
}
