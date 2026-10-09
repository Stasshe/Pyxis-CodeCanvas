import { resolvePath } from '@/engine/core/pathUtils';
import type { ShellRunResult } from './executor';
import type { Process } from './process';
import { readVariables } from './read';
import {
  assignArray,
  enterFunctionArguments,
  registerTrap,
  type ScriptControlState,
} from './scriptControls';
import { splitStatements } from './syntax';
import type { CompoundCommand, ShellExecutionOptions } from './types';

export interface ScriptShell {
  run(
    line: string,
    callbacks?: { stdout?: (data: string) => void; stderr?: (data: string) => void },
    execution?: ShellExecutionOptions
  ): Promise<ShellRunResult>;
  getEnvironment(): Readonly<Record<string, string>>;
  expandWords(
    source: string,
    callbacks?: { stdout?: (data: string) => void; stderr?: (data: string) => void }
  ): Promise<string[]>;
  setEnv(key: string, value: string): void;
  unsetEnv(key: string): void;
  getScriptState(): ScriptControlState;
  getEnv(key: string): string | undefined;
  getErrexit(): boolean;
  setErrexit(enabled: boolean): void;
  getErrtrace(): boolean;
  setErrtrace(enabled: boolean): void;
  getNounset(): boolean;
  finalizeInteractiveExit(proc: Process, status: number): Promise<number>;
  requestExit(code: number): void;
  getRequestedExit(): number | undefined;
  clearRequestedExit(): void;
  requestReturn(code: number): void;
  getRequestedReturn(): number | undefined;
  clearRequestedReturn(): void;
  setPipefail(enabled: boolean): void;
  setNounset(enabled: boolean): void;
}

/**
 * ScriptRunner - Executes shell scripts with control flow support
 * Handles if/elif/else/fi, for loops, while loops, break/continue
 */

const MAX_LOOP = 10000;
export const SHELL_CONTROL_COMMANDS = [
  'exit',
  'export',
  'return',
  'trap',
  'set',
  'unset',
  'break',
  'continue',
  'read',
] as const;

interface ScriptOptions {
  errexit: boolean;
  nounset: boolean;
  execution: ScriptExecutionOptions;
}

export interface ScriptExecutionOptions {
  initializeArguments?: boolean;
  finalizesShell?: boolean;
  errexitIgnored?: boolean;
  inFunction?: boolean;
  initialStatus?: number;
}

function updateOptions(args: string[], options: ScriptOptions, shell: ScriptShell): void {
  const words = args.slice(1);
  let enabled = true;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === undefined || word.length < 2) continue;
    const prefix = word[0];
    if (prefix !== '-' && prefix !== '+') continue;
    enabled = prefix === '-';
    if (word === '-o' || word === '+o') {
      const option = words[index + 1];
      setNamedOption(option, enabled, options, shell);
      index += 1;
      continue;
    }
    for (const flag of word.slice(1)) {
      if (flag === 'e') {
        options.errexit = enabled;
        shell.setErrexit(enabled);
      }
      if (flag === 'E') shell.setErrtrace(enabled);
      if (flag === 'u') {
        options.nounset = enabled;
        shell.setNounset(enabled);
      }
      if (flag === 'o') {
        const option = words[index + 1];
        setNamedOption(option, enabled, options, shell);
        index += 1;
      }
    }
  }
}

function setNamedOption(
  name: string | undefined,
  enabled: boolean,
  options: ScriptOptions,
  shell: ScriptShell
): void {
  if (name === 'pipefail') shell.setPipefail(enabled);
  if (name === 'errtrace') shell.setErrtrace(enabled);
  if (name === 'errexit') {
    options.errexit = enabled;
    shell.setErrexit(enabled);
  }
  if (name === 'nounset') {
    options.nounset = enabled;
    shell.setNounset(enabled);
  }
}

export type RunRangeResult = number | { exit: number } | { returned: number };

async function runRange(
  lines: string[],
  start: number,
  end: number,
  proc: Process,
  shell: ScriptShell,
  options: ScriptOptions,
  initialStatus = 0
): Promise<RunRangeResult> {
  let lastStatus = initialStatus;
  for (let index = start; index < end; index++) {
    shell.setEnv('?', String(lastStatus));
    const trimmed = lines[index].trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (await assignArray(trimmed, shell)) {
      lastStatus = 0;
      continue;
    }

    // Pass real-time output callbacks to enable streaming output
    const commandExecution: ShellExecutionOptions = {
      errexitIgnored: options.execution.errexitIgnored,
      inFunction: options.execution.inFunction,
      stdoutIsTTY: proc.stdoutIsTTY,
      stderrIsTTY: proc.stderrIsTTY,
    };
    if (proc.stdinRedirected || proc.stdinIsTTY) {
      commandExecution.stdin = proc.stdinStream;
      commandExecution.stdinDestination = proc.stdinDestination;
      commandExecution.stdinIsTTY = proc.stdinIsTTY && !proc.stdinRedirected;
    }
    const res = await shell.run(
      trimmed,
      {
        stdout: (data: string) => {
          proc.writeStdout(data);
        },
        stderr: (data: string) => {
          proc.writeStderr(data);
        },
      },
      commandExecution
    );
    lastStatus = res.code ?? 0;
    if (res.interrupted) return { exit: lastStatus };
    if (res.fatalError) return { exit: lastStatus };
    if (shell.getScriptState().loopControl) return lastStatus;
    const requestedExit = shell.getRequestedExit();
    if (requestedExit !== undefined) return { exit: requestedExit };
    const requestedReturn = shell.getRequestedReturn();
    if (requestedReturn !== undefined) return { returned: requestedReturn };
    const eligible =
      lastStatus !== 0 && res.errexitEligible !== false && !options.execution.errexitIgnored;
    if (eligible && (!options.execution.inFunction || shell.getErrtrace())) {
      const trapResult = await runTrap('ERR', lastStatus, proc, shell, options);
      if (trapResult !== undefined) return trapResult;
    }
    options.errexit = shell.getErrexit();
    options.nounset = shell.getNounset();
    if (options.errexit && eligible) {
      return { exit: lastStatus };
    }
  }
  return lastStatus;
}

/**
 * Execute a script text with control flow support
 * @param text - Script text
 * @param args - Positional args passed to the script (argv[0..])
 * @param proc - Process to write output to
 * @param shell - StreamShell instance for running commands
 */
export interface ControlResult {
  kind: 'status' | 'exit' | 'return';
  code: number;
}

export async function executeControlWords(
  words: string[],
  proc: Process,
  shell: ScriptShell,
  inFunction = false,
  previousStatus = Number(shell.getEnv('?') ?? '0')
): Promise<ControlResult | undefined> {
  const command = words[0];
  const parts = words.slice(1);
  if (command === 'read') return { kind: 'status', code: await readVariables(parts, proc, shell) };
  if (command === 'break' || command === 'continue') {
    const state = shell.getScriptState();
    const level = parts[0] ?? '1';
    if (parts.length > 1 || !/^\d+$/.test(level) || Number(level) < 1) {
      proc.writeStderr(`${command}: positive loop count required\n`);
      if (state.loopDepth > 0) state.loopControl = { kind: 'break', levels: state.loopDepth };
      return { kind: 'status', code: 1 };
    }
    if (state.loopDepth === 0) {
      proc.writeStderr(`${command}: only meaningful in a loop\n`);
      return { kind: 'status', code: 0 };
    }
    state.loopControl = { kind: command, levels: Math.min(Number(level), state.loopDepth) };
    return { kind: 'status', code: 0 };
  }
  if (command === 'exit' || command === 'return') {
    if (command === 'return' && !inFunction) {
      proc.writeStderr('return: can only return from a function\n');
      return { kind: 'status', code: 1 };
    }
    if (parts.length > 1) {
      proc.writeStderr(`${command}: too many arguments\n`);
      return { kind: 'status', code: 1 };
    }
    let code = previousStatus;
    if (parts.length === 1) {
      const argument = parts[0] ?? '';
      if (!/^[+-]?\d+$/.test(argument)) {
        proc.writeStderr(`${command}: numeric argument required\n`);
        code = 2;
      } else code = Number(argument) & 0xff;
    }
    if (command === 'return') {
      shell.requestReturn(code);
      return { kind: 'return', code };
    }
    const exitCode = await shell.finalizeInteractiveExit(proc, code);
    shell.requestExit(exitCode);
    return { kind: 'exit', code: exitCode };
  }
  if (command === 'trap') {
    const result = registerTrap(words, shell.getScriptState());
    if (result.stderr) proc.writeStderr(result.stderr);
    return { kind: 'status', code: result.code };
  }
  if (command === 'set') {
    const positional = parts.indexOf('--');
    if (positional >= 0) enterFunctionArguments(shell, parts.slice(positional + 1));
    let optionWords = words;
    if (positional >= 0) optionWords = words.slice(0, positional + 1);
    updateOptions(
      optionWords,
      { errexit: shell.getErrexit(), nounset: shell.getNounset(), execution: {} },
      shell
    );
    return { kind: 'status', code: 0 };
  }
  if (command === 'unset') {
    if (parts.length === 0) {
      proc.writeStderr('unset: missing variable name\n');
      return { kind: 'status', code: 1 };
    }
    for (const name of parts) shell.unsetEnv(name);
    return { kind: 'status', code: 0 };
  }
  if (command === 'export') {
    let code = 0;
    for (const assignment of parts) {
      const match = /^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/s.exec(assignment);
      if (!match) {
        proc.writeStderr(`export: ${assignment}: not a valid identifier\n`);
        code = 1;
        continue;
      }
      if (match[2] !== undefined) shell.setEnv(match[1], match[2]);
    }
    return { kind: 'status', code };
  }
  return undefined;
}

async function runTrap(
  signal: string,
  status: number,
  proc: Process,
  shell: ScriptShell,
  options: ScriptOptions
): Promise<RunRangeResult | undefined> {
  const state = shell.getScriptState();
  const handler = state.traps.get(signal);
  if (!handler || state.runningTraps.has(signal)) return undefined;
  state.runningTraps.add(signal);
  try {
    const lines = splitStatements(handler);
    const result = await runRange(lines, 0, lines.length, proc, shell, options, status);
    if (typeof result === 'object') return result;
    shell.setEnv('?', String(status));
    return undefined;
  } finally {
    state.runningTraps.delete(signal);
  }
}

export async function runInteractiveExitTrap(
  status: number,
  proc: Process,
  shell: ScriptShell,
  insideScript: boolean
): Promise<number> {
  if (insideScript) return status;
  const result = await runTrap('EXIT', status, proc, shell, {
    errexit: shell.getErrexit(),
    nounset: shell.getNounset(),
    execution: {},
  });
  if (typeof result === 'object' && 'exit' in result) return result.exit;
  return status;
}

export async function runScript(
  text: string,
  args: string[],
  proc: Process,
  shell: ScriptShell,
  execution: ScriptExecutionOptions = {}
): Promise<number> {
  const lines = splitStatements(text);
  const options: ScriptOptions = {
    errexit: shell.getErrexit(),
    nounset: shell.getNounset(),
    execution,
  };
  const initializeArguments = execution.initializeArguments !== false;
  let initialStatus = execution.initialStatus;
  if (initialStatus === undefined) initialStatus = Number(shell.getEnv('?') ?? '0');
  if (initializeArguments) {
    const currentDirectory = shell.getEnvironment().PWD;
    if (!currentDirectory) throw new Error('PWD is required to run a shell script');
    initialStatus = 0;
    if (args[0]) {
      const scriptPath = resolvePath(currentDirectory, args[0]);
      shell.setEnv('0', scriptPath);
      shell.setEnv('BASH_SOURCE', scriptPath);
      shell.setEnv('BASH_SOURCE[0]', scriptPath);
    }
    enterFunctionArguments(shell, args.slice(1));
  }
  const result = await runRange(lines, 0, lines.length, proc, shell, options, initialStatus);
  let status = 0;
  if (typeof result === 'number') status = result;
  else if (typeof result === 'object') {
    if ('exit' in result) status = result.exit;
    else status = result.returned;
  }
  let finalizesShell = execution.finalizesShell;
  if (finalizesShell === undefined) finalizesShell = initializeArguments;
  if (finalizesShell) {
    const requestedExit = shell.getRequestedExit();
    shell.clearRequestedExit();
    const trapResult = await runTrap('EXIT', status, proc, shell, options);
    if (typeof trapResult === 'object' && 'exit' in trapResult) status = trapResult.exit;
    if (requestedExit !== undefined && shell.getRequestedExit() === undefined)
      shell.requestExit(status);
  }
  shell.setEnv('?', String(status));
  return status;
}

/** Execute control nodes through the same process routing as groups and simple commands. */
export async function runCompound(
  compound: CompoundCommand,
  proc: Process,
  shell: ScriptShell,
  execution: ScriptExecutionOptions = {}
): Promise<number> {
  const options: ScriptOptions = {
    errexit: shell.getErrexit(),
    nounset: shell.getNounset(),
    execution,
  };
  const body = async (source: string): Promise<RunRangeResult> => {
    const statements = splitStatements(source);
    return runRange(
      statements,
      0,
      statements.length,
      proc,
      shell,
      options,
      Number(shell.getEnv('?') ?? '0')
    );
  };
  const condition = async (source: string) => {
    const commandExecution: ShellExecutionOptions = {
      stdoutIsTTY: proc.stdoutIsTTY,
      stderrIsTTY: proc.stderrIsTTY,
      errexitIgnored: true,
      inFunction: execution.inFunction,
    };
    if (proc.stdinRedirected || proc.stdinIsTTY) {
      commandExecution.stdin = proc.stdinStream;
      commandExecution.stdinDestination = proc.stdinDestination;
      commandExecution.stdinIsTTY = proc.stdinIsTTY && !proc.stdinRedirected;
    }
    const result = await shell.run(
      source,
      {
        stdout: data => proc.writeStdout(data),
        stderr: data => proc.writeStderr(data),
      },
      commandExecution
    );
    const code = result.code ?? 0;
    if (result.fatalError || result.interrupted) shell.requestExit(code);
    return code;
  };
  const status = (result: RunRangeResult) => {
    if (typeof result === 'number') return result;
    if ('exit' in result) return result.exit;
    return result.returned;
  };
  if (compound.kind === 'group' || compound.kind === 'subshell')
    return status(await body(compound.source));
  if (compound.kind === 'if') {
    for (const branch of compound.branches) {
      const code = await condition(branch.condition);
      if (
        shell.getRequestedExit() !== undefined ||
        shell.getRequestedReturn() !== undefined ||
        shell.getScriptState().loopControl
      )
        return code;
      if (code === 0) return status(await body(branch.body));
    }
    if (compound.otherwise !== undefined) return status(await body(compound.otherwise));
    return 0;
  }
  const state = shell.getScriptState();
  state.loopDepth++;
  let lastStatus = 0;
  try {
    let items: string[] = [];
    if (compound.kind === 'for') {
      if (compound.items !== undefined) items = await shell.expandWords(compound.items);
      else {
        const count = Number(shell.getEnv('#') ?? '0');
        for (let index = 1; index <= count; index++) items.push(shell.getEnv(String(index)) ?? '');
      }
    }
    for (let iteration = 0; iteration < MAX_LOOP; iteration++) {
      if (compound.kind === 'for') {
        if (iteration >= items.length) break;
        shell.setEnv(compound.variable, items[iteration]);
      } else {
        const code = await condition(compound.condition);
        if (shell.getRequestedExit() !== undefined || shell.getRequestedReturn() !== undefined)
          return code;
        const control = state.loopControl;
        if (control) {
          control.levels--;
          lastStatus = code;
          if (control.levels > 0) break;
          state.loopControl = undefined;
          if (control.kind === 'break') break;
          continue;
        }
        if (code !== 0) break;
      }
      if (shell.getRequestedExit() !== undefined || shell.getRequestedReturn() !== undefined) break;
      const result = await body(compound.body);
      lastStatus = status(result);
      if (typeof result !== 'number') break;
      const control = state.loopControl;
      if (control) {
        control.levels--;
        if (control.levels > 0) break;
        state.loopControl = undefined;
        if (control.kind === 'break') break;
      }
    }
    return lastStatus;
  } finally {
    state.loopDepth--;
  }
}
