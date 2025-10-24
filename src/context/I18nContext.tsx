/**
 * i18n Context Provider
 * グローバルなi18n状態管理
 */

'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type {
  Locale,
  I18nContextValue,
  TranslationKey,
  TranslateOptions,
} from '@/engine/i18n/types';
import { loadTranslations, preloadTranslations } from '@/engine/i18n/loader';
import { createTranslator } from '@/engine/i18n/translator';
import { cleanExpiredCache } from '@/engine/i18n/storage';

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const LOCALE_STORAGE_KEY = 'pyxis-locale';
const DEFAULT_LOCALE: Locale = 'en';

/**
 * ブラウザの言語設定から推奨ロケールを取得
 */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const browserLang = navigator.language.split('-')[0].toLowerCase();

  // サポートされている言語かチェック
  if (browserLang === 'ja' || browserLang === 'en') {
    return browserLang as Locale;
  }

  return DEFAULT_LOCALE;
}

/**
 * localStorageから保存されたロケールを取得
 */
function getSavedLocale(): Locale | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved === 'en' || saved === 'ja') {
      return saved as Locale;
    }
  } catch (error) {
    console.error('[i18n] Failed to get saved locale:', error);
  }

  return null;
}

/**
 * localStorageにロケールを保存
 */
function saveLocale(locale: Locale): void {
  if (typeof localStorage === 'undefined') return;

  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch (error) {
    console.error('[i18n] Failed to save locale:', error);
  }
}

interface I18nProviderProps {
  children: React.ReactNode;
  defaultLocale?: Locale;
}

export function I18nProvider({ children, defaultLocale }: I18nProviderProps) {
  // 初期ロケールの決定: 保存された値 → ブラウザ設定 → プロップス → デフォルト
  const initialLocale =
    getSavedLocale() || detectBrowserLocale() || defaultLocale || DEFAULT_LOCALE;

  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [translations, setTranslations] = useState<Record<string, unknown>>({});
  const [isLoading, setIsLoading] = useState(true);

  /**
   * 翻訳リソースをロード
   */
  const loadLocale = useCallback(async (newLocale: Locale) => {
    setIsLoading(true);
    try {
      const data = await loadTranslations(newLocale, 'common');
      setTranslations(data);
      setLocaleState(newLocale);
      saveLocale(newLocale);
    } catch (error) {
      console.error(`[i18n] Failed to load locale '${newLocale}':`, error);
      // フォールバック: デフォルトロケールを試す
      if (newLocale !== DEFAULT_LOCALE) {
        const fallbackData = await loadTranslations(DEFAULT_LOCALE, 'common');
        setTranslations(fallbackData);
        setLocaleState(DEFAULT_LOCALE);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * ロケール変更ハンドラ
   */
  const setLocale = useCallback(
    async (newLocale: Locale) => {
      if (newLocale === locale) return;
      await loadLocale(newLocale);
    },
    [locale, loadLocale]
  );

  /**
   * 翻訳関数
   */
  const t = useCallback(
    (key: TranslationKey, options?: TranslateOptions): string => {
      if (isLoading || Object.keys(translations).length === 0) {
        return options?.fallback || options?.defaultValue || key;
      }

      const translator = createTranslator(translations);
      return translator(key, options);
    },
    [translations, isLoading]
  );

  /**
   * 初回マウント時の処理
   */
  useEffect(() => {
    // 初期ロケールをロード
    loadLocale(initialLocale);

    // 期限切れキャッシュのクリーンアップ（バックグラウンド）
    cleanExpiredCache().catch(err => {
      console.error('[i18n] Failed to clean expired cache:', err);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const value: I18nContextValue = {
    locale,
    setLocale,
    t,
    isLoading,
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

/**
 * i18nコンテキストを使用するカスタムフック
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);

  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }

  return context;
}

/**
 * 翻訳関数のみを取得する軽量フック
 */
export function useTranslation() {
  const { t, locale, isLoading } = useI18n();
  return { t, locale, isLoading };
}
