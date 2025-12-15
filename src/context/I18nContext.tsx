/**
 * i18n Context Provider
 * グローバルなi18n状態管理
 *
 * 言語パック拡張機能と連携:
 * - 有効化された言語パック拡張機能のみが使用可能
 * - ユーザーが言語を切り替えるには、対応する言語パック拡張機能を有効化する必要がある
 */

'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'

import { DEFAULT_LOCALE, LOCALSTORAGE_KEY } from './config'

import { extensionManager } from '@/engine/extensions/extensionManager'
import { loadTranslations, clearAllCacheForLocale } from '@/engine/i18n/loader'
import { cleanExpiredCache } from '@/engine/i18n/storage-adapter'
import { createTranslator } from '@/engine/i18n/translator'
import type {
  Locale,
  I18nContextValue,
  TranslationKey,
  TranslateOptions,
} from '@/engine/i18n/types'
import { isSupportedLocale } from '@/engine/i18n/types'

const I18nContext = createContext<I18nContextValue | undefined>(undefined)

const LOCALE_STORAGE_KEY = LOCALSTORAGE_KEY.LOCALE

// 初期ロケール計算のキャッシュ（一度だけ計算）
let cachedInitialLocale: Locale | null = null

/**
 * 有効化された言語パック拡張機能から利用可能な言語を取得
 */
function getEnabledLocales(): Set<string> {
  const langPacks = extensionManager.getEnabledLanguagePacks()
  return new Set(langPacks.map(pack => pack.locale))
}

/**
 * ブラウザの言語設定から推奨ロケールを取得
 * 有効化された言語パック拡張機能の中から選択
 */
function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return DEFAULT_LOCALE

  const browserLang = navigator.language.split('-')[0].toLowerCase()
  const enabledLocales = getEnabledLocales()

  // まだ言語パックがロードされていない場合はブラウザ言語をそのまま使用
  if (enabledLocales.size === 0 && isSupportedLocale(browserLang)) {
    return browserLang as Locale
  }

  // 有効化された言語パックの中にブラウザ言語があるかチェック
  if (enabledLocales.has(browserLang) && isSupportedLocale(browserLang)) {
    return browserLang as Locale
  }

  // 有効化された言語パックの中にデフォルト言語があるかチェック
  if (enabledLocales.has(DEFAULT_LOCALE)) {
    return DEFAULT_LOCALE
  }

  // どれもなければ、有効化された最初の言語パックを使用
  const firstEnabled = Array.from(enabledLocales)[0]
  if (firstEnabled && isSupportedLocale(firstEnabled)) {
    return firstEnabled as Locale
  }

  return DEFAULT_LOCALE
}

/**
 * localStorageから保存されたロケールを取得
 * 有効化された言語パック拡張機能の中から選択
 */
function getSavedLocale(): Locale | null {
  if (typeof localStorage === 'undefined') return null

  try {
    const saved = localStorage.getItem(LOCALE_STORAGE_KEY)
    if (saved && isSupportedLocale(saved)) {
      // 保存された言語が有効化された言語パックの中にあるかチェック
      const enabledLocales = getEnabledLocales()
      // まだ言語パックがロードされていない場合は保存値をそのまま使用
      if (enabledLocales.size === 0) {
        return saved as Locale
      }
      if (enabledLocales.has(saved)) {
        return saved as Locale
      }
      console.warn(`[i18n] Saved locale '${saved}' is not enabled. Trying related locales...`)

      // 関連するロケールを試す (e.g., 'zh' if 'zh-TW' is not available)
      const baseLocale = saved.split('-')[0]
      if (baseLocale !== saved && enabledLocales.has(baseLocale)) {
        console.log(`[i18n] Falling back to related locale: ${baseLocale}`)
        return baseLocale as Locale
      }

      // zh -> zh-TW のパターンも試す
      const variants = Array.from(enabledLocales).filter(loc => loc.startsWith(baseLocale))
      if (variants.length > 0) {
        console.log(`[i18n] Falling back to related locale variant: ${variants[0]}`)
        return variants[0] as Locale
      }
    }
  } catch (error) {
    console.error('[i18n] Failed to get saved locale:', error)
  }

  return null
}

/**
 * localStorageにロケールを保存
 */
function saveLocale(locale: Locale): void {
  if (typeof localStorage === 'undefined') return

  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale)
  } catch (error) {
    console.error('[i18n] Failed to save locale:', error)
  }
}

interface I18nProviderProps {
  children: React.ReactNode
  defaultLocale?: Locale
}

export function I18nProvider({ children, defaultLocale }: I18nProviderProps) {
  // 初期ロケールの決定（キャッシュを使用して一度だけ計算）
  if (cachedInitialLocale === null) {
    cachedInitialLocale =
      getSavedLocale() || detectBrowserLocale() || defaultLocale || DEFAULT_LOCALE
  }
  const initialLocale = cachedInitialLocale

  const [locale, setLocaleState] = useState<Locale>(initialLocale)
  const [translations, setTranslations] = useState<Record<string, unknown>>({})
  const [isLoading, setIsLoading] = useState(true)

  /**
   * 翻訳リソースをロード
   */
  const loadLocale = useCallback(async (newLocale: Locale) => {
    setIsLoading(true)
    const namespaces = ['common', 'welcome', 'detail']
    try {
      const results = await Promise.all(namespaces.map(ns => loadTranslations(newLocale, ns)))
      const merged = Object.assign({}, ...results)

      setTranslations(merged)
      setLocaleState(newLocale)
      saveLocale(newLocale)
    } catch (error) {
      console.error(`[i18n] Failed to load locale '${newLocale}':`, error)
      // フォールバック: デフォルトロケールを試す
      if (newLocale !== DEFAULT_LOCALE) {
        try {
          const results = await Promise.all(
            namespaces.map(ns => loadTranslations(DEFAULT_LOCALE, ns))
          )
          const merged = Object.assign({}, ...results)
          setTranslations(merged)
          setLocaleState(DEFAULT_LOCALE)
        } catch (err) {
          console.error('[i18n] Failed to load fallback locale translations:', err)
        }
      }
    } finally {
      setIsLoading(false)
    }
  }, [])

  /**
   * ロケール変更ハンドラ
   * 有効化された言語パック拡張機能のみを許可
   */
  const setLocale = useCallback(
    async (newLocale: Locale) => {
      if (newLocale === locale) return

      // 有効化された言語パックの中にあるかチェック
      const enabledLocales = getEnabledLocales()
      if (!enabledLocales.has(newLocale)) {
        console.error(
          `[i18n] Cannot set locale '${newLocale}'. Language pack extension is not enabled.`
        )
        return
      }

      await loadLocale(newLocale)
    },
    [locale, loadLocale]
  )

  /**
   * 翻訳関数
   */
  const t = useCallback(
    (key: string | TranslationKey, options?: TranslateOptions): string => {
      if (isLoading || Object.keys(translations).length === 0) {
        return options?.fallback || options?.defaultValue || key
      }

      const translator = createTranslator(translations)
      return translator(key as TranslationKey, options)
    },
    [translations, isLoading]
  )

  /**
   * 拡張機能の変更を監視（言語パックの有効化/無効化/アンインストールに対応）
   */
  useEffect(() => {
    const unsubscribe = extensionManager.addChangeListener(event => {
      // 言語パック拡張機能の変更の場合
      if (event.manifest?.onlyOne === 'lang-pack') {
        const eventLocale = event.manifest.id.replace('pyxis.lang.', '')

        if (event.type === 'enabled') {
          // 言語パックが有効化された場合、その言語に自動的に切り替え
          if (isSupportedLocale(eventLocale)) {
            loadLocale(eventLocale as Locale)
          }
        } else if (event.type === 'disabled') {
          // 無効化された場合、現在の言語がそれなら切り替え
          if (eventLocale === locale) {
            // インストール済みの言語パックの中から適当に選んで切り替え
            extensionManager
              .getInstalledExtensions()
              .then(installed => {
                const installedLangPacks = installed.filter(
                  ext =>
                    ext.manifest &&
                    ext.manifest.onlyOne === 'lang-pack' &&
                    ext.manifest.id !== event.manifest?.id
                )

                if (installedLangPacks.length > 0) {
                  // 最初のインストール済み言語パックを有効化
                  const nextLangPack = installedLangPacks[0]
                  extensionManager.enableExtension(nextLangPack.manifest.id)
                } else {
                  // インストール済みの言語パックがない場合、英語パックをインストール・有効化
                  extensionManager
                    .installExtension('/extensions/lang-packs/en/manifest.json')
                    .then(installed => {
                      if (installed) {
                        return extensionManager.enableExtension('pyxis.lang.en')
                      }
                    })
                    .catch(err => {
                      console.error('[i18n] Failed to install/enable English pack:', err)
                      // 最終フォールバック: 直接ロード
                      if (isSupportedLocale('en')) {
                        loadLocale('en' as Locale)
                      }
                    })
                }
              })
              .catch(err => {
                console.error('[i18n] Failed to switch language pack:', err)
              })
          }
        } else if (event.type === 'uninstalled') {
          // アンインストール時はキャッシュをクリア
          if (isSupportedLocale(eventLocale)) {
            clearAllCacheForLocale(eventLocale as Locale).catch(err => {
              console.error(`[i18n] Failed to clear cache for locale '${eventLocale}':`, err)
            })
          }
        }
      }
    })
    return unsubscribe
  }, [locale, loadLocale])

  /**
   * 初回マウント時の処理
   */
  useEffect(() => {
    // 初期ロケールをロード
    loadLocale(initialLocale)

    // 期限切れキャッシュのクリーンアップ（バックグラウンド）
    cleanExpiredCache().catch(err => {
      console.error('[i18n] Failed to clean expired cache:', err)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const value: I18nContextValue = {
    locale,
    setLocale,
    t,
    isLoading,
  }

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
}

/**
 * i18nコンテキストを使用するカスタムフック
 */
export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext)

  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider')
  }

  return context
}

/**
 * 翻訳関数のみを取得する軽量フック
 */
export function useTranslation() {
  const { t, locale, isLoading } = useI18n()
  return { t, locale, isLoading }
}
