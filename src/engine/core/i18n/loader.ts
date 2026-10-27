/**
 * i18n Resource Loader
 * 翻訳リソースの動的ロードとキャッシュ管理
 */

import { assetPath } from '@/env';
import { loadTranslationCache, saveTranslationCache } from './storage-adapter';
import type { Locale } from './types';

/**
 * メモリキャッシュ（高速アクセス用）
 */
const memoryCache = new Map<string, Record<string, unknown>>();

/**
 * 翻訳リソースを取得（メモリ → IndexedDB → HTTP の順）
 */
export async function loadTranslations(
  locale: Locale,
  namespace = 'common'
): Promise<Record<string, unknown>> {
  const cacheKey = `${locale}-${namespace}`;

  // 1. メモリキャッシュをチェック
  if (memoryCache.has(cacheKey)) {
    return memoryCache.get(cacheKey)!;
  }

  // 2. IndexedDBキャッシュをチェック
  try {
    const cachedData = await loadTranslationCache(locale, namespace);
    if (cachedData) {
      memoryCache.set(cacheKey, cachedData);
      return cachedData;
    }
  } catch (error) {
    console.warn(`[i18n-loader] Failed to read cache for ${locale}/${namespace}:`, error);
  }

  // 3. HTTPで取得
  try {
    const response = await fetch(assetPath(`/locales/${locale}/${namespace}.json`));

    if (!response.ok) {
      throw new Error(`Failed to load translations: ${response.status} ${response.statusText}`);
    }

    const data: unknown = await response.json();
    if (!isTranslationDictionary(data)) {
      throw new Error(`Invalid translation resource: ${locale}/${namespace}`);
    }

    // A cache write failure must not hide a successful resource fetch.
    memoryCache.set(cacheKey, data);
    try {
      await saveTranslationCache(locale, namespace, data);
    } catch (error) {
      console.warn(`[i18n-loader] Failed to write cache for ${locale}/${namespace}:`, error);
    }

    return data;
  } catch (error) {
    console.error(`[i18n-loader] Failed to load ${locale}/${namespace}:`, error);

    // フォールバック: enを試す
    if (locale !== 'en') {
      console.warn(`[i18n-loader] Falling back to 'en' for namespace '${namespace}'`);
      return loadTranslations('en', namespace);
    }

    // 最終フォールバック: 空オブジェクト
    return {};
  }
}

function isTranslationDictionary(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * 翻訳リソースをプリロード（起動時に使用）
 */
export async function preloadTranslations(
  locale: Locale,
  namespaces: string[] = ['common']
): Promise<void> {
  await Promise.all(namespaces.map(ns => loadTranslations(locale, ns)));
}

/**
 * メモリキャッシュをクリア
 */
export function clearMemoryCache(): void {
  memoryCache.clear();
  console.log('[i18n-loader] Memory cache cleared');
}

/**
 * 特定のロケールのメモリキャッシュをクリア
 */
export function clearMemoryCacheForLocale(locale: Locale): void {
  const keysToDelete: string[] = [];
  for (const key of memoryCache.keys()) {
    if (key.startsWith(`${locale}-`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => {
    memoryCache.delete(key);
  });
  console.log(`[i18n-loader] Cleared ${keysToDelete.length} entries for locale '${locale}'`);
}

/**
 * 特定のロケールの全てのキャッシュ（メモリ + IndexedDB）をクリア
 */
export async function clearAllCacheForLocale(locale: Locale): Promise<void> {
  // メモリキャッシュをクリア
  clearMemoryCacheForLocale(locale);

  // IndexedDBキャッシュをクリア
  const { deleteAllTranslationCacheForLocale } = await import('./storage-adapter');
  await deleteAllTranslationCacheForLocale(locale);

  console.log(`[i18n-loader] Cleared all cache (memory + IndexedDB) for locale '${locale}'`);
}
