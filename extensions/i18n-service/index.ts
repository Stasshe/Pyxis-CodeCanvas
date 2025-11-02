/**
 * Pyxis i18n Service Extension
 * 
 * 多言語対応サービスを提供
 * IndexedDB + public/locales のハイブリッドキャッシュ
 */

import type { ExtensionContext, ExtensionActivation } from '../_shared/types.js';

/**
 * サポートする言語のリスト
 */
const SUPPORTED_LOCALES = [
  'en', 'ja', 'zh', 'zh-TW', 'ko', 'es', 'fr', 'de', 
  'it', 'pt', 'ru', 'ar', 'hi', 'id', 'th', 'vi',
  'tr', 'pl', 'nl', 'sv'
];

/**
 * 翻訳データの型
 */
type TranslationData = Record<string, any>;

/**
 * i18nサービスの実装
 */
class I18nService {
  private context: ExtensionContext;
  private currentLocale: string = 'en';
  private translations: Map<string, TranslationData> = new Map();

  constructor(context: ExtensionContext) {
    this.context = context;
  }

  /**
   * 言語を設定
   */
  async setLocale(locale: string): Promise<void> {
    if (!SUPPORTED_LOCALES.includes(locale)) {
    this.context.logger?.warn(`Locale not supported: ${locale}, falling back to 'en'`);
      locale = 'en';
    }

    this.currentLocale = locale;
    await this.loadTranslations(locale);
  }

  /**
   * 現在の言語を取得
   */
  getLocale(): string {
    return this.currentLocale;
  }

  /**
   * 翻訳データをロード
   */
  async loadTranslations(locale: string): Promise<TranslationData | null> {
    // すでにロード済みの場合
    if (this.translations.has(locale)) {
      return this.translations.get(locale)!;
    }

    // IndexedDBキャッシュをチェック
    const cacheKey = `translations:${locale}`;
  const cached = await this.context.storage?.get<TranslationData>(cacheKey);
    
    if (cached) {
  this.context.logger?.info(`i18n: Loaded from cache - ${locale}`);
      this.translations.set(locale, cached);
      return cached;
    }

    // public/locales から fetch
    try {
      const response = await fetch(`/locales/${locale}/common.json`);
      if (!response.ok) {
        throw new Error(`Failed to load ${locale}`);
      }
      
      const data = await response.json();
      
      // メモリキャッシュに保存
      this.translations.set(locale, data);
      
      // IndexedDBキャッシュに保存（7日間）
      if (this.context.storage) {
        await this.context.storage.set(cacheKey, data);
      }

      this.context.logger?.info(`i18n: Fetched and cached - ${locale}`);
      return data;
    } catch (error) {
  this.context.logger?.error(`i18n: Failed to load ${locale}`, error);
      return null;
    }
  }

  /**
   * キーから翻訳を取得
   */
  translate(key: string, params?: Record<string, string>): string {
    const translations = this.translations.get(this.currentLocale);
    if (!translations) {
      return key;
    }

    // ネストされたキーを解決 (例: "menu.file.open")
    const keys = key.split('.');
    let value: any = translations;
    
    for (const k of keys) {
      if (value && typeof value === 'object') {
        value = value[k];
      } else {
        return key; // fallback
      }
    }
    
    let result = typeof value === 'string' ? value : key;

    // パラメータ置換 (例: "Hello {name}")
    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${paramKey}\\}`, 'g'), paramValue);
      }
    }

    return result;
  }

  /**
   * サポートされている言語のリストを取得
   */
  getSupportedLocales(): string[] {
    return [...SUPPORTED_LOCALES];
  }

  /**
   * 翻訳キャッシュをクリア
   */
  async clearCache(): Promise<void> {
    this.translations.clear();
    
    // IndexedDBキャッシュもクリア
    for (const locale of SUPPORTED_LOCALES) {
      const cacheKey = `translations:${locale}`;
      if (this.context.storage) {
        await this.context.storage.delete(cacheKey);
      }
    }
    
  this.context.logger?.info('i18n: Cache cleared');
  }
}

/**
 * 拡張機能のアクティベーション
 */
export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.logger?.info('i18n Service Extension activating...');

  const i18nService = new I18nService(context);

  // デフォルト言語をロード
  await i18nService.setLocale('en');

  context.logger?.info('i18n Service Extension activated');

  return {
    services: {
      i18n: {
        setLocale: i18nService.setLocale.bind(i18nService),
        getLocale: i18nService.getLocale.bind(i18nService),
        translate: i18nService.translate.bind(i18nService),
        t: i18nService.translate.bind(i18nService), // ショートカット
        getSupportedLocales: i18nService.getSupportedLocales.bind(i18nService),
        clearCache: i18nService.clearCache.bind(i18nService),
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
