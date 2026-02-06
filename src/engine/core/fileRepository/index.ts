/**
 * fileRepository エントリーポイント
 * 環境に応じて IndexedDB 実装 or InMemory 実装を切り替えて re-export する
 */

import * as indexeddbImpl from './indexeddb';
import * as inmemoryImpl from './inmemory';

// ブラウザ環境判定: window と IDBKeyRange の両方が存在する場合のみ IndexedDB を使用
// jest.setup.js は indexedDB.open のみスタブしており IDBKeyRange は未定義のため、
// テスト環境では自動的に InMemory にフォールバックする
const useInMemory = typeof window === 'undefined' || typeof IDBKeyRange === 'undefined';
const impl = useInMemory ? inmemoryImpl : indexeddbImpl;

// 実装切り替え exports
export const fileRepository = impl.fileRepository;
export const FileRepository = impl.FileRepository;

// 型 (共通)
export type { FileChangeEvent } from './indexeddb';

// deprecated パスユーティリティ (実装非依存)
export { normalizePath, getParentPath, toGitPath, fromGitPath } from './indexeddb';

// pathUtils 再エクスポート
export * from '../pathUtils';
