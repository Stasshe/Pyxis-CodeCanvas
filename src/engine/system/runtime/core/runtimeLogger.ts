export type RuntimeLogLevel = 'info' | 'warn' | 'error';
export type RuntimeLogSink = (message: string, level: RuntimeLogLevel) => void;

const hostConsole = console;

let sink: RuntimeLogSink = (message, level) => {
  if (level === 'info') hostConsole.info(message);
  if (level === 'warn') hostConsole.warn(message);
  if (level === 'error') hostConsole.error(message);
};

export function setRuntimeLogSink(next: RuntimeLogSink): void {
  sink = next;
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

export function formatRuntimeArgs(args: unknown[]): string {
  return args.map(formatValue).join(' ');
}

export function runtimeInfo(...args: unknown[]): void {
  sink(formatRuntimeArgs(args), 'info');
}

export function runtimeWarn(...args: unknown[]): void {
  sink(formatRuntimeArgs(args), 'warn');
}

export function runtimeError(...args: unknown[]): void {
  sink(formatRuntimeArgs(args), 'error');
}
