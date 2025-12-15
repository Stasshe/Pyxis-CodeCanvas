/**
 * Terminal History Storage
 * IndexedDBを使用したターミナルコマンド履歴管理
 * プロジェクトごとに履歴を保持し、高頻度更新に対応
 */

import { storageService, STORES } from '@/engine/storage';

/**
 * メモリキャッシュ（高頻度アクセス対応）
 */
const historyCache = new Map<string, string[]>();

/**
 * プロジェクトごとの履歴キーを生成
 */
function getHistoryKey(projectId: string): string {
  return `terminal-history-${projectId}`;
}

/**
 * ターミナルコマンド履歴を保存（非同期）
 */
export async function saveTerminalHistory(projectId: string, history: string[]): Promise<void> {
  try {
    const key = getHistoryKey(projectId);
    
    // メモリキャッシュを更新
    historyCache.set(key, history);
    
    // IndexedDBに保存（キャッシュを有効にして高速化）
    await storageService.set(STORES.TERMINAL_HISTORY, key, history, { cache: true });
    
    console.log(`[TerminalHistory] Saved ${history.length} commands for project: ${projectId}`);
  } catch (error) {
    console.warn('[TerminalHistory] Failed to save terminal history:', error);
  }
}

/**
 * ターミナルコマンド履歴を取得（非同期）
 */
export async function getTerminalHistory(projectId: string): Promise<string[]> {
  try {
    const key = getHistoryKey(projectId);
    
    // メモリキャッシュから取得を試みる
    if (historyCache.has(key)) {
      console.log(`[TerminalHistory] Cache hit for project: ${projectId}`);
      return historyCache.get(key)!;
    }
    
    // IndexedDBから取得
    const history = await storageService.get<string[]>(STORES.TERMINAL_HISTORY, key);
    
    if (history) {
      // キャッシュに保存
      historyCache.set(key, history);
      console.log(`[TerminalHistory] Loaded ${history.length} commands for project: ${projectId}`);
      return history;
    }
    
    console.log(`[TerminalHistory] No history found for project: ${projectId}`);
    return [];
  } catch (error) {
    console.warn('[TerminalHistory] Failed to load terminal history:', error);
    return [];
  }
}

/**
 * ターミナルコマンド履歴を削除（非同期）
 */
export async function clearTerminalHistory(projectId: string): Promise<void> {
  try {
    const key = getHistoryKey(projectId);
    
    // メモリキャッシュから削除
    historyCache.delete(key);
    
    // IndexedDBから削除
    await storageService.delete(STORES.TERMINAL_HISTORY, key);
    
    console.log(`[TerminalHistory] Cleared history for project: ${projectId}`);
  } catch (error) {
    console.warn('[TerminalHistory] Failed to clear terminal history:', error);
  }
}

/**
 * 全てのターミナルコマンド履歴を削除（非同期）
 */
export async function clearAllTerminalHistory(): Promise<void> {
  try {
    // メモリキャッシュをクリア
    historyCache.clear();
    
    // IndexedDBのTERMINAL_HISTORYストア全体をクリア
    await storageService.clear(STORES.TERMINAL_HISTORY);
    
    console.log('[TerminalHistory] Cleared all terminal history');
  } catch (error) {
    console.warn('[TerminalHistory] Failed to clear all terminal history:', error);
  }
}

/**
 * 同期版の保存（後方互換性のため、内部で非同期版を呼び出す）
 * @deprecated 非同期版のsaveTerminalHistoryを使用してください
 */
export function saveTerminalHistorySync(projectId: string, history: string[]): void {
  saveTerminalHistory(projectId, history).catch(error => {
    console.warn('[TerminalHistory] Sync save failed:', error);
  });
}

/**
 * 同期版の取得（後方互換性のため、キャッシュから返す）
 * @deprecated 非同期版のgetTerminalHistoryを使用してください
 */
export function getTerminalHistorySync(projectId: string): string[] {
  const key = getHistoryKey(projectId);
  return historyCache.get(key) || [];
}
