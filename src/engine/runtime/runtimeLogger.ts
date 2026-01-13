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

export function runtimeInfo(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'info', 'Runtime');
  } catch {
    // ignore
  }
}

export function runtimeWarn(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'warn', 'Runtime');
  } catch {
    // ignore
  }
}

export function runtimeError(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'error', 'Runtime');
  } catch {
    // ignore
  }
}
