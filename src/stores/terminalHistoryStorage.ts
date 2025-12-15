/**
 * Terminal History Storage
 * IndexedDBを使用したターミナルコマンド履歴管理（プロジェクト別）
 */

import { storageService, STORES } from '@/engine/storage';

const historyCache = new Map<string, string[]>();

function getHistoryKey(projectId: string): string {
  return `terminal-history-${projectId}`;
}

export async function saveTerminalHistory(projectId: string, history: string[]): Promise<void> {
  const key = getHistoryKey(projectId);
  historyCache.set(key, history);
  await storageService.set(STORES.TERMINAL_HISTORY, key, history, { cache: true });
}

export async function getTerminalHistory(projectId: string): Promise<string[]> {
  const key = getHistoryKey(projectId);
  
  if (historyCache.has(key)) {
    return historyCache.get(key)!;
  }
  
  const history = await storageService.get<string[]>(STORES.TERMINAL_HISTORY, key);
  
  if (history) {
    historyCache.set(key, history);
    return history;
  }
  
  return [];
}

export async function clearTerminalHistory(projectId: string): Promise<void> {
  const key = getHistoryKey(projectId);
  historyCache.delete(key);
  await storageService.delete(STORES.TERMINAL_HISTORY, key);
}

export async function clearAllTerminalHistory(): Promise<void> {
  historyCache.clear();
  await storageService.clear(STORES.TERMINAL_HISTORY);
}
