import { STORES, storageService } from '@/engine/storage';

/**
 * Terminal History Storage (migrated)
 * - Previously used sessionStorage. Now persisted in IndexedDB via storageService under USER_PREFERENCES.
 * - All APIs are async and return Promises.
 */
const TERMINAL_HISTORY_KEY_PREFIX = 'terminalHistory_';

/**
 * ターミナルコマンド履歴を保存
 */
export async function saveTerminalHistory(projectName: string, history: string[]): Promise<void> {
  try {
    const key = `${TERMINAL_HISTORY_KEY_PREFIX}${projectName}`;
    await storageService.set(STORES.USER_PREFERENCES, key, history);
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to save terminal history:', error);
  }
}

/**
 * ターミナルコマンド履歴を取得
 */
export async function getTerminalHistory(projectName: string): Promise<string[]> {
  try {
    const key = `${TERMINAL_HISTORY_KEY_PREFIX}${projectName}`;
    const saved = await storageService.get<string[]>(STORES.USER_PREFERENCES, key);
    return saved || [];
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to load terminal history:', error);
    return [];
  }
}

/**
 * ターミナルコマンド履歴を削除
 */
export async function clearTerminalHistory(projectName: string): Promise<void> {
  try {
    const key = `${TERMINAL_HISTORY_KEY_PREFIX}${projectName}`;
    await storageService.delete(STORES.USER_PREFERENCES, key);
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to clear terminal history:', error);
  }
}

/**
 * 全てのターミナルコマンド履歴を削除
 */
export async function clearAllTerminalHistory(): Promise<void> {
  try {
    const all = await storageService.getAll(STORES.USER_PREFERENCES);
    const keysToDelete = all
      .map(e => e.id)
      .filter(id => id.startsWith(TERMINAL_HISTORY_KEY_PREFIX));

    await Promise.all(keysToDelete.map(k => storageService.delete(STORES.USER_PREFERENCES, k)));
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to clear all terminal history:', error);
  }
}
