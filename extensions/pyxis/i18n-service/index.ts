/**
 * Pyxis i18n Service Extension
 * 
 * 多言語対応サービス
 * 既存のi18nシステムを拡張機能として提供
 */

import type { ExtensionContext, ExtensionActivation } from '@/engine/extensions/types';

/**
 * 拡張機能のアクティベーション
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger.info('i18n Service Extension activating...');

  // 既存のi18n storage adapterを使用
  const {
    saveTranslationCache,
    loadTranslationCache,
    deleteTranslationCache,
    clearAllTranslationCache,
  } = await import('@/engine/i18n/storage-adapter');

  /**
   * 翻訳データをロード
   */
  const loadTranslations = async (locale: string, namespace = 'common') => {
    context.logger.info(`Loading translations: ${locale}/${namespace}`);

    // キャッシュから取得を試みる
    const cached = await loadTranslationCache(locale as any, namespace);
    if (cached) {
      context.logger.info(`i18n: Loaded from cache - ${locale}/${namespace}`);
      return cached;
    }

    // /locales/{locale}/{namespace}.json をfetch
    try {
      const url = `/locales/${locale}/${namespace}.json`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`Failed to load ${url} (${response.status})`);
      }

      const data = await response.json();

      // キャッシュに保存
      await saveTranslationCache(locale as any, namespace, data);

      context.logger.info(`i18n: Fetched and cached - ${locale}/${namespace}`);
      return data;
    } catch (error) {
      context.logger.error(`i18n: Failed to load ${locale}/${namespace}`, error);
      return null;
    }
  };

  /**
   * 翻訳キーを解決
   */
  const translate = (translations: Record<string, any>, key: string): string => {
    const keys = key.split('.');
    let value: any = translations;

    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // fallback
      }
    }

    return typeof value === 'string' ? value : key;
  };

  /**
   * 複数キーを一括翻訳
   */
  const translateBatch = (
    translations: Record<string, any>,
    keys: string[]
  ): Record<string, string> => {
    const result: Record<string, string> = {};
    for (const key of keys) {
      result[key] = translate(translations, key);
    }
    return result;
  };

  /**
   * 変数を含む翻訳
   */
  const translateWithVars = (
    translations: Record<string, any>,
    key: string,
    vars: Record<string, string | number>
  ): string => {
    let text = translate(translations, key);

    // {{variable}} 形式の変数を置換
    for (const [varKey, varValue] of Object.entries(vars)) {
      const regex = new RegExp(`\\{\\{${varKey}\\}\\}`, 'g');
      text = text.replace(regex, String(varValue));
    }

    return text;
  };

  /**
   * サポートされているロケールのリスト
   */
  const getSupportedLocales = (): string[] => {
    return [
      'en', 'ja', 'zh', 'zh-TW', 'ko',
      'es', 'fr', 'de', 'it', 'pt',
      'ru', 'ar', 'hi', 'id', 'th',
      'vi', 'tr', 'pl', 'nl', 'sv',
    ];
  };

  /**
   * キャッシュをクリア
   */
  const clearCache = async (locale?: string, namespace?: string) => {
    if (locale && namespace) {
      await deleteTranslationCache(locale as any, namespace);
      context.logger.info(`i18n: Cleared cache - ${locale}/${namespace}`);
    } else {
      await clearAllTranslationCache();
      context.logger.info('i18n: Cleared all cache');
    }
  };

  context.logger.info('i18n Service Extension activated');

  return {
    services: {
      i18n: {
        loadTranslations,
        translate,
        translateBatch,
        translateWithVars,
        getSupportedLocales,
        clearCache,
      },
    },
  };
}

/**
 * 拡張機能のデアクティベーション
 */
export async function deactivate(): Promise<void> {
  console.log('[i18n Service] Deactivating...');
}
