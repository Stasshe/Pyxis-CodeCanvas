import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel';

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    if (typeof value === 'undefined') return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  } catch {
    return String(value);
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(a => safeStringify(a)).join(' ');
}

export function coreInfo(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'info', 'core');
  } catch {
    // ignore
  }
}

export function coreWarn(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'warn', 'core');
  } catch {
    // ignore
  }
}

export function coreError(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'error', 'core');
  } catch {
    // ignore
  }
}
