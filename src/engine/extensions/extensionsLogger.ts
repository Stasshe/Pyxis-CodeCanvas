import { pushMsgOutPanel } from '@/components/Bottom/BottomPanel'

function safeStringify(value: unknown): string {
  try {
    if (typeof value === 'string') return value
    if (typeof value === 'undefined') return 'undefined'
    if (value === null) return 'null'
    if (typeof value === 'object') return JSON.stringify(value, null, 2)
    return String(value)
  } catch {
    return String(value)
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(a => safeStringify(a)).join(' ')
}

export function extensionInfo(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'info', 'extensions')
  } catch {
    // ignore
  }
}

export function extensionWarn(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'warn', 'extensions')
  } catch {
    // ignore
  }
}

export function extensionError(...args: unknown[]): void {
  try {
    pushMsgOutPanel(formatArgs(args), 'error', 'extensions')
  } catch {
    // ignore
  }
}
