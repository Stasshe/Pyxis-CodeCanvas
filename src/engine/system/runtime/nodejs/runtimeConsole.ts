import { runtimeError, runtimeInfo, runtimeWarn } from '../core/runtimeLogger';
import type { RuntimeConsole } from './runtimeTypes';

export interface RuntimeConsoleSink {
  log(...args: unknown[]): void;
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
}

export function createRuntimeConsole(
  sink: RuntimeConsoleSink | undefined,
  isEnabled: () => boolean,
  clear: () => void
): RuntimeConsole {
  const counts = new Map<string, number>();
  const timers = new Map<string, number>();
  let groupDepth = 0;

  const write = (level: 'log' | 'error' | 'warn', args: unknown[]) => {
    if (!isEnabled()) return;
    const output = args;
    if (groupDepth > 0) output.unshift('  '.repeat(groupDepth));
    if (level === 'error') {
      if (sink?.error) sink.error(...output);
      else runtimeError(...output);
      return;
    }
    if (level === 'warn') {
      if (sink?.warn) sink.warn(...output);
      else runtimeWarn(...output);
      return;
    }
    if (sink?.log) sink.log(...output);
    else runtimeInfo(...output);
  };

  const logDuration = (label: string, ...args: unknown[]): boolean => {
    const startedAt = timers.get(label);
    if (startedAt === undefined) {
      write('warn', [`Timer '${label}' does not exist`]);
      return false;
    }
    write('log', [`${label}: ${(performance.now() - startedAt).toFixed(3)}ms`, ...args]);
    return true;
  };

  return {
    log: (...args) => write('log', args),
    info: (...args) => write('log', args),
    debug: (...args) => write('log', args),
    error: (...args) => write('error', args),
    warn: (...args) => write('warn', args),
    dir: (...args) => write('log', args),
    dirxml: (...args) => write('log', args),
    table: (...args) => write('log', args),
    trace: (...args) => {
      const stack = new Error().stack;
      if (stack) write('error', [...args, stack]);
    },
    assert: (condition, ...args) => {
      if (!condition) write('error', ['Assertion failed:', ...args]);
    },
    count: (label = 'default') => {
      const count = (counts.get(label) ?? 0) + 1;
      counts.set(label, count);
      write('log', [`${label}: ${count}`]);
    },
    countReset: (label = 'default') => {
      if (!counts.has(label)) {
        write('warn', [`Count for '${label}' does not exist`]);
        return;
      }
      counts.set(label, 0);
    },
    time: (label = 'default') => {
      if (timers.has(label)) {
        write('warn', [`Timer '${label}' already exists`]);
        return;
      }
      timers.set(label, performance.now());
    },
    timeLog: (label = 'default', ...args) => logDuration(label, ...args),
    timeEnd: (label = 'default') => {
      if (logDuration(label)) timers.delete(label);
    },
    group: (...args) => {
      write('log', args);
      groupDepth += 1;
    },
    groupCollapsed: (...args) => {
      write('log', args);
      groupDepth += 1;
    },
    groupEnd: () => {
      groupDepth = Math.max(0, groupDepth - 1);
    },
    clear: () => {
      if (isEnabled()) clear();
    },
  };
}
