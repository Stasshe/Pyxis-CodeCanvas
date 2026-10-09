/**
 * i18n Storage Adapter
 * 汎用ストレージレイヤーをi18n用にラップするアダプター
 */

import { STORES, storageService } from '@/engine/storage';
import { pyxisEnv } from '@/env';
import type { Locale } from './types';

const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7日間

interface CachedTranslations {
  version: string;
  data: Record<string, unknown>;
}

/**
 * 翻訳データをIndexedDBに保存
 */
export async function saveTranslationCache(
  locale: Locale,
  namespace: string,
  data: Record<string, unknown>
): Promise<void> {
  const id = `${locale}-${namespace}`;
  const cache: CachedTranslations = { version: pyxisEnv.version, data };
  await storageService.set(STORES.TRANSLATIONS, id, cache, { ttl: CACHE_EXPIRY_MS });
}

/**
 * IndexedDBから翻訳データを取得
 */
export async function loadTranslationCache(
  locale: Locale,
  namespace: string
): Promise<Record<string, unknown> | null> {
  const id = `${locale}-${namespace}`;
  const cache = await storageService.get<unknown>(STORES.TRANSLATIONS, id);
  if (cache === null || cache === undefined) return null;
  if (!isCachedTranslations(cache) || cache.version !== pyxisEnv.version) {
    await deleteTranslationCache(locale, namespace);
    return null;
  }
  return cache.data;
}

function isCachedTranslations(value: unknown): value is CachedTranslations {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const cache = value as Partial<CachedTranslations>;
  return (
    typeof cache.version === 'string' &&
    cache.data !== null &&
    typeof cache.data === 'object' &&
    !Array.isArray(cache.data)
  );
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
