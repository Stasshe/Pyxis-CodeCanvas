import { type PyxisSession, sessionStore } from '@/stores/sessionStore';
// src/hooks/useOptimizedUIStateSave.ts
import { useCallback, useEffect, useRef } from 'react';

/**
 * 最適化された UI 保存フック
 * - 保存間隔を制限して頻繁な書き込みを防ぐ
 * - 内部で再スケジューリング可能なタイマーを持つ
 */
export function useOptimizedUIStateSave() {
  const timerRef = useRef<number | null>(null);
  const lastSaveRef = useRef<number>(0);
  const MIN_SAVE_INTERVAL = 3000; // ms

  const saveUIState = useCallback(async (uiState: PyxisSession['ui']) => {
    const now = Date.now();

    // 前回保存から短すぎる場合は延期する
    if (now - lastSaveRef.current < MIN_SAVE_INTERVAL) {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => {
        saveUIState(uiState);
      }, MIN_SAVE_INTERVAL);
      return;
    }

    try {
      await sessionStorage.saveUIState(uiState);
      lastSaveRef.current = Date.now();
      console.log('[useOptimizedUIStateSave] UI state saved to storage');
    } catch (error) {
      console.error('[useOptimizedUIStateSave] Failed to save UI state:', error);
    }
  }, []);

  // クリーンアップ
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { saveUIState, timerRef } as const;
}
