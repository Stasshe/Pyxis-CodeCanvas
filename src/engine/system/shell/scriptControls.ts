import { readBalanced } from './syntax';
import type { OutputCallbacks } from './types';

export interface ScriptControlShell {
  getEnvironment(): Readonly<Record<string, string>>;
  setEnv(key: string, value: string): void;
  unsetEnv(key: string): void;
  expandWords(source: string, callbacks?: OutputCallbacks): Promise<string[]>;
}

export interface ScriptControlState {
  loopDepth: number;
  loopControl?: { kind: 'break' | 'continue'; levels: number };
  functions: Map<string, string>;
  traps: Map<string, string>;
  runningTraps: Set<string>;
}

export function createScriptControlState(): ScriptControlState {
  return {
    loopDepth: 0,
    functions: new Map(),
    traps: new Map(),
    runningTraps: new Set(),
  };
}

export function cloneScriptControlState(state: ScriptControlState): ScriptControlState {
  return {
    loopDepth: 0,
    functions: new Map(state.functions),
    traps: new Map(state.traps),
    runningTraps: new Set(),
  };
}

const supportedSignals = new Set(['ERR', 'EXIT']);

export function registerTrap(
  words: string[],
  state: ScriptControlState
): { code: number; stderr: string } {
  if (words[0] !== 'trap') return { code: 1, stderr: 'trap: invalid invocation\n' };
  const args = words.slice(1);
  if (args.length === 0) return { code: 0, stderr: '' };

  let action = args[0];
  let signals = args.slice(1);
  let remove = false;
  if (action === '-') {
    remove = true;
    action = '';
  } else if (action === '--') {
    action = args[1] ?? '';
    signals = args.slice(2);
    if (action === '-') {
      remove = true;
      action = '';
    }
  }
  if (signals.length === 0) return { code: 2, stderr: 'trap: missing signal\n' };

  const normalized: string[] = [];
  for (const signal of signals) {
    const name = normalizeSignal(signal);
    if (name === null)
      return { code: 1, stderr: `trap: unsupported signal specification: ${signal}\n` };
    normalized.push(name);
  }
  for (const signal of normalized) {
    if (remove) state.traps.delete(signal);
    else state.traps.set(signal, action ?? '');
  }
  return { code: 0, stderr: '' };
}

function normalizeSignal(signal: string): string | null {
  const name = signal.toUpperCase();
  if (/^\d+$/.test(name) && Number(name) === 0) return 'EXIT';
  if (!supportedSignals.has(name)) return null;
  return name;
}

export async function assignArray(source: string, shell: ScriptControlShell): Promise<boolean> {
  const trimmed = source.trim();
  const match = /^([A-Za-z_][A-Za-z0-9_]*)=\(/.exec(trimmed);
  if (match === null) return false;
  const name = match[1];
  if (name === undefined) return false;
  const opening = trimmed.indexOf('(', match[0].length - 1);
  let end: number;
  try {
    end = readBalanced(trimmed, opening);
  } catch {
    return false;
  }
  if (trimmed.slice(end).trim().length > 0) return false;

  const values = await shell.expandWords(trimmed.slice(opening + 1, end - 1));
  const environment = shell.getEnvironment();
  for (const key of Object.keys(environment)) {
    if (key.startsWith(`${name}[`) && key.endsWith(']')) shell.unsetEnv(key);
  }
  shell.unsetEnv(name);
  if (values.length === 0) return true;
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    if (value !== undefined) shell.setEnv(`${name}[${index}]`, value);
  }
  return true;
}

export function enterFunctionArguments(shell: ScriptControlShell, args: string[]): () => void {
  const environment = shell.getEnvironment();
  const saved = new Map<string, string | undefined>();
  for (const key of Object.keys(environment)) {
    if (/^(?:[1-9]\d*|#|@|\*)$/.test(key)) saved.set(key, environment[key]);
  }
  for (const key of saved.keys()) shell.unsetEnv(key);
  for (let index = 0; index < args.length; index++) {
    const value = args[index];
    if (value !== undefined) shell.setEnv(String(index + 1), value);
  }
  shell.setEnv('#', String(args.length));
  shell.setEnv('@', args.join(' '));
  shell.setEnv('*', args.join(' '));

  return () => {
    const current = shell.getEnvironment();
    for (const key of Object.keys(current)) {
      if (/^(?:[1-9]\d*|#|@|\*)$/.test(key)) shell.unsetEnv(key);
    }
    for (const [key, value] of saved) {
      if (value !== undefined) shell.setEnv(key, value);
    }
  };
}
