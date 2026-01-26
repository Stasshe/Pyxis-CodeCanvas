// src/hooks/useFileDeleteTabSync.ts
/**
 * ファイル削除イベントをタブストアに同期するカスタムフック
 *
 * 責務:
 * - fileRepositoryの削除イベントを監視
 * - 削除されたファイルに対応するタブを閉じる
 * - tabStore.handleFileDeleted()を呼び出して適切に処理
 * - バッチ削除時のパフォーマンス最適化（デバウンス処理）
 *
 * 使用箇所:
 * - page.tsxで使用して、アプリ全体で一度だけ実行
 */

import { useEffect, useRef } from 'react';

import { fileRepository } from '@/engine/core/fileRepository';
import { useTabStore } from '@/stores/tabStore';

/**
 * デバウンス時間（ミリ秒）
 * バッチ削除（rm -rf, npm uninstallなど）では複数の削除イベントが
 * 短時間に集中するため、これらをまとめて処理することで
 * 不要な再レンダリングとタブ検索の繰り返しを防ぐ
 */
const DEBOUNCE_MS = 100;

export function useFileDeleteTabSync() {
  const handleFileDeleted = useTabStore(state => state.handleFileDeleted);
  const handleFilesDeleted = useTabStore(state => state.handleFilesDeleted);
  const pendingDeletesRef = useRef<Set<string>>(new Set());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const processPendingDeletes = () => {
      if (pendingDeletesRef.current.size === 0) return;

      // 収集した全ての削除パスを処理
      const pathsToDelete = Array.from(pendingDeletesRef.current);
      pendingDeletesRef.current.clear();

      // 単一ファイルの場合は従来通りの処理
      if (pathsToDelete.length === 1) {
        handleFileDeleted(pathsToDelete[0]);
        return;
      }

      // 複数ファイルの場合はバッチ処理（一度のタブ検索で全て処理）
      handleFilesDeleted(pathsToDelete);
    };

    // fileRepositoryの削除イベントを監視
    const unsubscribe = fileRepository.addChangeListener(event => {
      if (event.type === 'delete') {
        // 削除パスを収集
        pendingDeletesRef.current.add(event.file.path);

        // 既存のタイマーをクリア
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }

        // 新しいタイマーを設定（デバウンス）
        timeoutRef.current = setTimeout(processPendingDeletes, DEBOUNCE_MS);
      }
    });

    return () => {
      // クリーンアップ
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        // 残っている削除を処理
        processPendingDeletes();
      }
      unsubscribe();
    };
  }, [handleFileDeleted, handleFilesDeleted]);
}
