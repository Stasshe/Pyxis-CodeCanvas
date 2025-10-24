/**
 * i18n Type Definitions
 * 型安全なi18n実装のための型定義
 */

import type enCommon from '../../../public/locales/en/common.json';

/**
 * サポートする言語コード
 */
export type Locale =
  | 'en'
  | 'ja'
  | 'es'
  | 'fr'
  | 'de'
  | 'zh'
  | 'zh-TW'
  | 'ko'
  | 'it'
  | 'pt'
  | 'ru'
  | 'nl'
  | 'tr'
  | 'ar'
  | 'hi'
  | 'th'
  | 'vi'
  | 'id'
  | 'sv'
  | 'pl';

/*
オランダ語	nl	ヨーロッパで広く使用
トルコ語	tr	トルコ・中央アジア
アラビア語	ar	中東・北アフリカ
ヒンディー語	hi	インド
タイ語	th	タイ
ベトナム語	vi	ベトナム
インドネシア語	id	インドネシア
スウェーデン語	sv	北欧
ポーランド語	pl	東欧
*/

/**
 * 翻訳リソースの型
 * enのcommonをベースに型推論
 */
export type TranslationResources = {
  common: typeof enCommon;
};

/**
 * ネストされたオブジェクトからキーパスを生成する型ユーティリティ
 * 例: { a: { b: "text" } } => "a.b"
 */
type PathImpl<T, Key extends keyof T> = Key extends string
  ? T[Key] extends Record<string, unknown>
    ?
        | `${Key}.${PathImpl<T[Key], Exclude<keyof T[Key], keyof Array<unknown>>> & string}`
        | `${Key}.${Exclude<keyof T[Key], keyof Array<unknown>> & string}`
    : never
  : never;

type Path<T> = PathImpl<T, keyof T> | (keyof T & string);

/**
 * 翻訳キーの型
 * TranslationResourcesから全てのキーパスを抽出
 */
export type TranslationKey = Path<TranslationResources['common']>;

/**
 * 翻訳関数のオプション
 */
export interface TranslateOptions {
  /** 変数の埋め込み用オブジェクト */
  params?: Record<string, string | number>;
  /** フォールバックテキスト（翻訳が見つからない場合） */
  fallback?: string;
  /** デフォルト値（翻訳が見つからない場合はキーを返す） */
  defaultValue?: string;
}

/**
 * i18nコンテキストの値の型
 */
export interface I18nContextValue {
  /** 現在の言語 */
  locale: Locale;
  /** 言語を変更する関数 */
  setLocale: (locale: Locale) => Promise<void>;
  /** 翻訳関数 */
  // key を string に拡張して、実装側で安全にキャストできるようにする
  t: (key: string | TranslationKey, options?: TranslateOptions) => string;
  /** ローディング状態 */
  isLoading: boolean;
}

/**
 * 翻訳データのキャッシュエントリ
 */
export interface TranslationCacheEntry {
  locale: Locale;
  namespace: string;
  data: Record<string, unknown>;
  timestamp: number;
}
