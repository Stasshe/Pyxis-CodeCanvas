/**
 * i18n Storage Adapter
 * 汎用ストレージレイヤーをi18n用にラップするアダプター
 */

import type { Locale } from './types';

import { storageService, STORES } from '@/engine/storage';

const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7日間

/**
 * 翻訳データをIndexedDBに保存
 */
export async function saveTranslationCache(
  locale: Locale,
  namespace: string,
  data: Record<string, unknown>
): Promise<void> {
  const id = `${locale}-${namespace}`;
  await storageService.set(STORES.TRANSLATIONS, id, data, { ttl: CACHE_EXPIRY_MS });
}

/**
 * IndexedDBから翻訳データを取得
 */
export async function loadTranslationCache(
  locale: Locale,
  namespace: string
): Promise<Record<string, unknown> | null> {
  const id = `${locale}-${namespace}`;
  return await storageService.get<Record<string, unknown>>(STORES.TRANSLATIONS, id);
}

/**
 * 翻訳キャッシュを削除
 */
export async function deleteTranslationCache(locale: Locale, namespace: string): Promise<void> {
  const id = `${locale}-${namespace}`;
  await storageService.delete(STORES.TRANSLATIONS, id);
}

/**
 * 特定のロケールの全ての翻訳キャッシュを削除
 */
export async function deleteAllTranslationCacheForLocale(locale: Locale): Promise<void> {
  // 一般的なnamespaceをすべて削除
  const commonNamespaces = ['common', 'welcome', 'detail'];

  for (const namespace of commonNamespaces) {
    try {
      await deleteTranslationCache(locale, namespace);
    } catch (error) {
      console.error(`[i18n-storage] Failed to delete cache for ${locale}-${namespace}:`, error);
    }
  }

  console.log(`[i18n-storage] Deleted all translation cache for locale: ${locale}`);
}

/**
 * 全ての翻訳キャッシュをクリア
 */
export async function clearAllTranslationCache(): Promise<void> {
  await storageService.clear(STORES.TRANSLATIONS);
}

/**
 * 古いキャッシュを削除（メンテナンス用）
 */
export async function cleanExpiredCache(): Promise<void> {
  await storageService.cleanExpired();
}
