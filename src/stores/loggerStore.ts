import { proxy } from 'valtio/vanilla';

import { OUTPUT_CONFIG } from '@/constants/config';

export type OutputType = 'info' | 'error' | 'warn' | 'check';

export interface OutputMessage {
  message: string;
  type?: OutputType;
  context?: string;
  count?: number;
}

// Vanilla Valtio store (React非依存)
export const loggerStore = proxy<{
  messages: OutputMessage[];
}>({
  messages: [],
});

/**
 * ログメッセージをストアに追加
 * engine層から直接呼び出し可能（React非依存）
 */
export function pushLogMessage(
  msg: string,
  type?: OutputType,
  context?: string
): void {
  const messages = loggerStore.messages;
  const last = messages[messages.length - 1];

  // 直前のメッセージと同じ内容・type・contextなら回数を増やす
  if (
    last &&
    last.message === msg &&
    last.type === type &&
    last.context === context
  ) {
    last.count = (last.count ?? 1) + 1;
  } else {
    // 新規メッセージ
    messages.push({ message: msg, type, context });
  }

  // 最大数制限
  const max = OUTPUT_CONFIG.OUTPUT_MAX_MESSAGES ?? 30;
  if (messages.length > max) {
    // 古いメッセージを削除
    loggerStore.messages.splice(0, messages.length - max);
  }

  if ( type === 'info' ) {
    // 情報メッセージはコンソールにも出力
    console.log(`[${context ?? 'unknown'}] ${msg}`);
  }
  
  if ( type === 'warn' ) {
    // 警告メッセージはコンソールにも出力
    console.warn(`[${context ?? 'unknown'}] ${msg}`);
  }

  if ( type === 'error' ) {
    // エラーメッセージはコンソールにも出力
    console.error(`[${context ?? 'unknown'}] ${msg}`);
  }
}

/**
 * 指定されたメッセージをストアから削除
 */
export function removeLogMessages(toRemove: OutputMessage[]): void {
  loggerStore.messages = loggerStore.messages.filter(
    m => !toRemove.includes(m)
  );
}

/**
 * すべてのログメッセージをクリア
 */
export function clearAllLogs(): void {
  loggerStore.messages = [];
}
