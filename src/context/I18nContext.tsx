/**
 * i18n Context Provider
 * グローバルなi18n状態管理
 *
 * 言語パック拡張機能と連携:
 * - 有効化された言語パック拡張機能のみが使用可能
 * - ユーザーが言語を切り替えるには、対応する言語パック拡張機能を有効化する必要がある
 */

'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type {
  Locale,
  I18nContextValue,
  TranslationKey,
  TranslateOptions,
} from '@/engine/i18n/types';
import { isSupportedLocale } from '@/engine/i18n/types';
import { loadTranslations, preloadTranslations } from '@/engine/i18n/loader';
import { createTranslator } from '@/engine/i18n/translator';
import { cleanExpiredCache } from '@/engine/i18n/storage-adapter';
import { DEFAULT_LOCALE, LOCALSTORAGE_KEY } from './config';
import { extensionManager } from '@/engine/extensions/extensionManager';

const I18nContext = createContext<I18nContextValue | undefined>(undefined);

const LOCALE_STORAGE_KEY = LOCALSTORAGE_KEY.LOCALE;

/**
 * 有効化された言語パック拡張機能から利用可能な言語を取得
 */
function getEnabledLocales(): Set<string> {
  const langPacks = extensionManager.getEnabledLanguagePacks();
  return new Set(langPacks.map(pack => pack.locale));
}

/**
 * ブラウザの言語設定から推奨ロケールを取得
 * 有効化された言語パック拡張機能の中から選択
 */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE;

  const browserLang = navigator.language.split('-')[0].toLowerCase();
  const enabledLocales = getEnabledLocales();

  // 有効化された言語パックの中にブラウザ言語があるかチェック
  if (enabledLocales.has(browserLang) && isSupportedLocale(browserLang)) {
    return browserLang as Locale;
  }

  // 有効化された言語パックの中にデフォルト言語があるかチェック
  if (enabledLocales.has(DEFAULT_LOCALE)) {
    return DEFAULT_LOCALE;
  }

  // どれもなければ、有効化された最初の言語パックを使用
  const firstEnabled = Array.from(enabledLocales)[0];
  if (firstEnabled && isSupportedLocale(firstEnabled)) {
    return firstEnabled as Locale;
  }

  return DEFAULT_LOCALE;
}

/**
 * localStorageから保存されたロケールを取得
 * 有効化された言語パック拡張機能の中から選択
 */
function getSavedLocale(): Locale | null {
  if (typeof localStorage === 'undefined') return null;

  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (saved && isSupportedLocale(saved)) {
      // 保存された言語が有効化された言語パックの中にあるかチェック
      const enabledLocales = getEnabledLocales();
      if (enabledLocales.has(saved)) {
        return saved as Locale;
      }
      console.warn(
        `[i18n] Saved locale '${saved}' is not enabled. Language pack extension may be disabled.`
      );
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
    const namespaces = ['common', 'welcome', 'detail'];
    try {
      // Load multiple namespaces that components expect to access.
      // WelcomeTab uses `welcome.*` keys stored in `welcome.json`, while
      // most UI strings live in `common.json`.

      const results = await Promise.all(namespaces.map(ns => loadTranslations(newLocale, ns)));

      // Merge namespace objects into a single translations object. Later namespaces
      // will override earlier keys if they clash (not expected here).
      const merged = Object.assign({}, ...results);

      setTranslations(merged);
      setLocaleState(newLocale);
      saveLocale(newLocale);
    } catch (error) {
      console.error(`[i18n] Failed to load locale '${newLocale}':`, error);
      // フォールバック: デフォルトロケールを試す
      if (newLocale !== DEFAULT_LOCALE) {
        try {
          const results = await Promise.all(
            namespaces.map(ns => loadTranslations(DEFAULT_LOCALE, ns))
          );
          const merged = Object.assign({}, ...results);
          setTranslations(merged);
          setLocaleState(DEFAULT_LOCALE);
        } catch (err) {
          console.error('[i18n] Failed to load fallback locale translations:', err);
        }
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * ロケール変更ハンドラ
   * 有効化された言語パック拡張機能のみを許可
   */
  const setLocale = useCallback(
    async (newLocale: Locale) => {
      if (newLocale === locale) return;

      // 有効化された言語パックの中にあるかチェック
      const enabledLocales = getEnabledLocales();
      if (!enabledLocales.has(newLocale)) {
        console.error(
          `[i18n] Cannot set locale '${newLocale}'. Language pack extension is not enabled.`
        );
        return;
      }

      await loadLocale(newLocale);
    },
    [locale, loadLocale]
  );

  /**
   * 翻訳関数
   */
  const t = useCallback(
    (key: string | TranslationKey, options?: TranslateOptions): string => {
      if (isLoading || Object.keys(translations).length === 0) {
        return options?.fallback || options?.defaultValue || key;
      }

      const translator = createTranslator(translations);
      // translator expects a TranslationKey; cast here after runtime checks
      return translator(key as TranslationKey, options);
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

    // 拡張機能の変更を監視（言語パックの有効化/無効化/アンインストールに対応）
    const unsubscribe = extensionManager.addChangeListener(event => {
      // 言語パック拡張機能の変更の場合
      if (event.manifest?.onlyOne === 'lang-pack') {
        const eventLocale = event.manifest.id.replace('pyxis.lang.', '');

        if (event.type === 'enabled') {
          // 言語パックが有効化された場合、その言語に自動的に切り替え
          if (isSupportedLocale(eventLocale)) {
            console.log(`[i18n] Language pack '${eventLocale}' enabled. Switching locale...`);
            loadLocale(eventLocale as Locale);
          }
        } else if (event.type === 'disabled' || event.type === 'uninstalled') {
          // 現在の言語が無効化/アンインストールされた場合
          if (eventLocale === locale) {
            // 有効な言語パックに切り替え
            const enabledLocales = getEnabledLocales();
            const firstEnabled = Array.from(enabledLocales)[0];
            if (firstEnabled && isSupportedLocale(firstEnabled)) {
              console.log(
                `[i18n] Current locale '${locale}' was disabled. Switching to '${firstEnabled}'`
              );
              loadLocale(firstEnabled as Locale);
            } else {
              console.warn('[i18n] No enabled language packs available');
            }
          }
        }
      }
    });

    return unsubscribe;
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
