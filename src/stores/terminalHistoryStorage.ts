/**
 * Terminal History Storage
 * sessionStorageを使用したターミナルコマンド履歴管理
 * ブラウザセッション内でのみデータを保持
 */

const TERMINAL_HISTORY_PREFIX = 'pyxis_terminal_history_';

/**
 * ターミナルコマンド履歴を保存
 */
export function saveTerminalHistory(projectName: string, history: string[]): void {
  try {
    const key = `${TERMINAL_HISTORY_PREFIX}${projectName}`;
    sessionStorage.setItem(key, JSON.stringify(history));
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to save terminal history:', error);
  }
}

/**
 * ターミナルコマンド履歴を取得
 */
export function getTerminalHistory(projectName: string): string[] {
  try {
    const key = `${TERMINAL_HISTORY_PREFIX}${projectName}`;
    const saved = sessionStorage.getItem(key);
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to load terminal history:', error);
  }
  return [];
}

/**
 * ターミナルコマンド履歴を削除
 */
export function clearTerminalHistory(projectName: string): void {
  try {
    const key = `${TERMINAL_HISTORY_PREFIX}${projectName}`;
    sessionStorage.removeItem(key);
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to clear terminal history:', error);
  }
}

/**
 * 全てのターミナルコマンド履歴を削除
 */
export function clearAllTerminalHistory(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key && key.startsWith(TERMINAL_HISTORY_PREFIX)) {
        keys.push(key);
      }
    }
    keys.forEach(key => sessionStorage.removeItem(key));
  } catch (error) {
    console.warn('[terminalHistoryStorage] Failed to clear all terminal history:', error);
  }
}
