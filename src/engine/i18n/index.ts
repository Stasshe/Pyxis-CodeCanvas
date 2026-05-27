/**
 * i18n Module Exports
 * i18nシステムの公開API
 */

// Context & Hooks
export { I18nProvider, useI18n, useTranslation } from '@/context/I18nContext';
// Utilities (開発/デバッグ用)
export { clearMemoryCache, loadTranslations, preloadTranslations } from './loader';
export { createTranslator, translatePlural } from './translator';
// Types
export type { I18nContextValue, Locale, TranslateOptions, TranslationKey } from './types';
