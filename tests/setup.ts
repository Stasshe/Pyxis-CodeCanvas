/**
 * Vitest グローバルセットアップ
 * テスト環境共通の初期化処理
 *
 * ブラウザ専用モジュールのグローバルモックを定義し、
 * テストファイルごとに重複する vi.mock() を不要にする
 */

import { vi } from 'vitest';

// ==================== ブラウザ専用モジュールのグローバルモック ====================
// indexeddb.ts が import する gitFileSystem / syncManager は
// ブラウザ API に依存するため、Node 環境では読み込みに失敗する。
// ここでモックしておくことで、index.ts 経由の import が安全になる。

vi.mock('@/engine/core/gitFileSystem', () => ({
  gitFileSystem: {
    getProjectDir: (name: string) => `/projects/${name}`,
    ensureDirectory: vi.fn(),
    flush: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
    readdir: vi.fn().mockResolvedValue([]),
    stat: vi.fn(),
    mkdir: vi.fn(),
  },
}));

vi.mock('@/engine/core/syncManager', () => ({
  syncManager: {
    syncSingleFileToFS: vi.fn(),
    syncFromIndexedDBToFS: vi.fn(),
    syncFromFSToIndexedDB: vi.fn(),
  },
}));
