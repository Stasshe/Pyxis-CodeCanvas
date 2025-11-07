/**
 * i18n Translator
 * 翻訳キーの解決と変数の補間
 */

import type { TranslationKey, TranslateOptions } from './types';

/**
 * ネストされたオブジェクトから指定されたパスの値を取得
 */
function getNestedValue(obj: Record<string, unknown>, path: string): string | undefined {
  const keys = path.split('.');
  let current: unknown = obj;

  for (const key of keys) {
    if (current && typeof current === 'object' && key in current) {
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
      if (options?.fallback) {
        text = options.fallback;
      } else if (options?.defaultValue) {
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

/**
 * 複数形対応の翻訳（将来の拡張用）
 */
export function translatePlural(
  singular: string,
  plural: string,
  count: number,
  params?: Record<string, string | number>
): string {
  const text = count === 1 ? singular : plural;
  return interpolate(text, { ...params, count });
}
