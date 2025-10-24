/**
 * i18n Module Exports
 * i18nシステムの公開API
 */

// Types
export type { Locale, TranslationKey, TranslateOptions, I18nContextValue } from './types';

// Context & Hooks
export { I18nProvider, useI18n, useTranslation } from '@/context/I18nContext';

// Utilities (開発/デバッグ用)
export { loadTranslations, preloadTranslations, clearMemoryCache } from './loader';
export { clearAllTranslationCache, cleanExpiredCache } from './storage';
export { createTranslator, translatePlural } from './translator';
