// src/hooks/useFileDeleteTabSync.ts
/**
 * ファイル削除イベントをタブストアに同期するカスタムフック
 *
 * 責務:
 * - fileRepositoryの削除イベントを監視
 * - 削除されたファイルに対応するタブを閉じる
 * - tabStore.handleFileDeleted()を呼び出して適切に処理
 *
 * 使用箇所:
 * - page.tsxで使用して、アプリ全体で一度だけ実行
 */

import { useEffect } from 'react';

import { fileRepository } from '@/engine/core/fileRepository';
import { useTabStore } from '@/stores/tabStore';

export function useFileDeleteTabSync() {
  const handleFileDeleted = useTabStore(state => state.handleFileDeleted);

  useEffect(() => {
    console.log('[useFileDeleteTabSync] Setting up file deletion listener');

    // fileRepositoryの削除イベントを監視
    const unsubscribe = fileRepository.addChangeListener(event => {
      if (event.type === 'delete') {
        const deletedPath = event.file.path;
        console.log('[useFileDeleteTabSync] File deleted, closing tabs for:', deletedPath);
        handleFileDeleted(deletedPath);
      }
    });

    return () => {
      console.log('[useFileDeleteTabSync] Cleaning up file deletion listener');
      unsubscribe();
    };
  }, [handleFileDeleted]);
}
