/**
 * i18n Translator
 * 翻訳キーの解決と変数の補間
 */

import type { TranslateOptions, TranslationKey } from './types';

/** Merge namespace dictionaries while preserving nested keys from earlier namespaces. */
export function mergeTranslations(
  ...resources: Record<string, unknown>[]
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};

  for (const resource of resources) {
    for (const [key, value] of Object.entries(resource)) {
      const previous = merged[key];
      if (isTranslationObject(previous) && isTranslationObject(value)) {
        merged[key] = mergeTranslations(previous, value);
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}

function isTranslationObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * ネストされたオブジェクトから指定されたパスの値を取得
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && Object.hasOwn(current, key)) {
      current = (current as Record<string, unknown>)[key];
    } else {
      return undefined;
    }
  }

  return typeof current === 'string' ? current : undefined;
}

/**
 * 変数を補間する（例: "Hello {name}" + {name: "World"} => "Hello World"）
 */
function interpolate(text: string, params?: Record<string, string | number>): string {
  if (!params) return text;

  return text.replace(/\{(\w+)\}/g, (match, key) => {
    return key in params ? String(params[key]) : match;
  });
}

/**
 * 翻訳関数を作成
 */
export function createTranslator(translations: Record<string, unknown>) {
  return (key: TranslationKey, options?: TranslateOptions): string => {
    // 翻訳を取得
    let text = getNestedValue(translations, key);

    // 翻訳が見つからない場合
    if (text === undefined) {
      if (options?.fallback !== undefined) {
        text = options.fallback;
      } else if (options?.defaultValue !== undefined) {
        text = options.defaultValue;
      } else {
        // デフォルト: キーをそのまま返す
        // console.warn(`[i18n] Translation not found: ${key}`);
        return key;
      }
    }

    // 変数を補間
    return interpolate(text, options?.params);
  };
}
