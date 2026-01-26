'use client';

import { useEffect } from 'react';

import { registerBuiltinTabs } from '@/engine/tabs/registerBuiltinTabs';
import { initializeExtensions } from '@/engine/extensions/autoInstaller';
import { initializeBuiltinRuntimes } from '@/engine/runtime/builtinRuntimes';

/**
 * アプリケーション全体の初期化をまとめたコンポーネント
 * - タブの登録
 * - ビルトインランタイムの初期化
 * - 拡張機能の初期化
 */
export default function AppInitializer() {
  useEffect(() => {
    let mounted = true;

    (async () => {
      try {
        // タブを登録
        registerBuiltinTabs();

        // ビルトインランタイムを初期化
        initializeBuiltinRuntimes();

        // 拡張機能を初期化
        await initializeExtensions();

        if (mounted) {
          // noop: initialization complete
        }
      } catch (err) {
        // don't throw in client render path
        console.error('[AppInitializer] failed to initialize', err);
      }
    })();

    return () => {
      mounted = false;
    };
  }, []);

  return null;
}
