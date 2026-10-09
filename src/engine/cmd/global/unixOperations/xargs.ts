import { UnixCommandBase, UnixCommandFailure } from './base';

export interface XargsInvocation {
  command: string;
  args: string[];
}

export interface XargsPlan {
  invocations: XargsInvocation[];
  maxParallelism: number;
  trace: boolean;
}

interface XargsOptions {
  delimiter: '\0' | 'whitespace';
  maxArguments: number | null;
  maxParallelism: number;
  noRunIfEmpty: boolean;
  trace: boolean;
  replacement: string | null;
}

interface ParsedArguments {
  options: XargsOptions;
  command: string[];
}

const defaultOptions: XargsOptions = {
  delimiter: 'whitespace',
  maxArguments: null,
  maxParallelism: 1,
  noRunIfEmpty: false,
  trace: false,
  replacement: null,
};

export class XargsCommand extends UnixCommandBase {
  expand(args: string[], input: string): XargsPlan {
    const parsed = parseArguments(args);
    const command = parsed.command[0] ?? 'echo';
    const initialArgs = parsed.command.slice(1);
    const options = parsed.options;
    let invocations: XargsInvocation[];
    if (options.replacement === null) {
      invocations = makeArgumentInvocations(
        command,
        initialArgs,
        splitInput(input, options.delimiter),
        options
      );
    } else {
      invocations = makeReplacementInvocations(command, initialArgs, input, options.replacement);
    }

    if (invocations.length === 0 && !options.noRunIfEmpty && options.replacement === null) {
      invocations.push({ command, args: initialArgs });
    }

    return {
      invocations,
      maxParallelism: options.maxParallelism,
      trace: options.trace,
    };
  }
}

function parseArguments(args: string[]): ParsedArguments {
  const options = { ...defaultOptions };
  let index = 0;

  while (index < args.length) {
    const argument = args[index];
    if (argument === '--') {
      index += 1;
      break;
    }
    if (argument === '-0') {
      options.delimiter = '\0';
      index += 1;
      continue;
    }
    if (argument === '-r') {
      options.noRunIfEmpty = true;
      index += 1;
      continue;
    }
    if (argument === '-t') {
      options.trace = true;
      index += 1;
      continue;
    }
    if (isGroupedFlagOption(argument)) {
      for (const flag of argument.slice(1)) {
        if (flag === '0') options.delimiter = '\0';
        if (flag === 'r') options.noRunIfEmpty = true;
        if (flag === 't') options.trace = true;
      }
      index += 1;
      continue;
    }

    const maxArguments = optionValue(argument, '-n', args, index);
    if (maxArguments) {
      const value = parsePositiveInteger(maxArguments.value, '-n', false);
      options.maxArguments = value;
      index = maxArguments.nextIndex;
      continue;
    }

    const maxParallelism = optionValue(argument, '-P', args, index);
    if (maxParallelism) {
      options.maxParallelism = parsePositiveInteger(maxParallelism.value, '-P', true);
      index = maxParallelism.nextIndex;
      continue;
    }

    const replacement = replacementValue(argument, args, index);
    if (replacement) {
      options.replacement = replacement.value;
      index = replacement.nextIndex;
      continue;
    }

    if (argument.startsWith('-')) {
      throw new UnixCommandFailure(`xargs: unknown option '${argument}'`, 1);
    }
    break;
  }

  return { options, command: args.slice(index) };
}

function optionValue(
  argument: string,
  option: '-n' | '-P',
  args: string[],
  index: number
): { value: string; nextIndex: number } | null {
  if (argument === option) {
    const value = args[index + 1];
    if (value === undefined) {
      throw new UnixCommandFailure(`xargs: option '${option}' requires an argument`, 1);
    }
    return { value, nextIndex: index + 2 };
  }
  if (argument.startsWith(option) && argument.length > option.length) {
    return { value: argument.slice(option.length), nextIndex: index + 1 };
  }
  return null;
}

function isGroupedFlagOption(argument: string): boolean {
  return argument.length > 2 && /^-[0rt]+$/.test(argument);
}

function replacementValue(
  argument: string,
  args: string[],
  index: number
): { value: string; nextIndex: number } | null {
  if (argument === '-I') {
    const value = args[index + 1];
    if (value === undefined) {
      throw new UnixCommandFailure("xargs: option '-I' requires an argument", 1);
    }
    return { value, nextIndex: index + 2 };
  }
  if (argument.startsWith('-I') && argument.length > 2) {
    return { value: argument.slice(2), nextIndex: index + 1 };
  }
  if (argument === '--replace') return { value: '{}', nextIndex: index + 1 };
  if (argument.startsWith('--replace=')) {
    const value = argument.slice('--replace='.length);
    return { value: value || '{}', nextIndex: index + 1 };
  }
  return null;
}

function parsePositiveInteger(value: string, option: string, allowZero: boolean): number {
  if (!/^\d+$/.test(value)) {
    throw new UnixCommandFailure(`xargs: invalid number '${value}' for '${option}'`, 1);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || (!allowZero && parsed === 0)) {
    throw new UnixCommandFailure(`xargs: invalid number '${value}' for '${option}'`, 1);
  }
  return parsed;
}

function splitInput(input: string, delimiter: XargsOptions['delimiter']): string[] {
  if (delimiter === '\0') {
    return input
      .split('\0')
      .filter((word, index, words) => index < words.length - 1 || word.length > 0);
  }
  return splitWords(input);
}

function makeArgumentInvocations(
  command: string,
  initialArgs: string[],
  input: string[],
  options: XargsOptions
): XargsInvocation[] {
  if (input.length === 0) return [];
  const chunkSize = options.maxArguments ?? input.length;
  const invocations: XargsInvocation[] = [];
  for (let offset = 0; offset < input.length; offset += chunkSize) {
    invocations.push({
      command,
      args: [...initialArgs, ...input.slice(offset, offset + chunkSize)],
    });
  }
  return invocations;
}

function makeReplacementInvocations(
  command: string,
  initialArgs: string[],
  input: string,
  replacement: string
): XargsInvocation[] {
  return input
    .split(/\r?\n/)
    .filter(line => line.length > 0)
    .map(line => ({
      command,
      args: initialArgs.map(argument => argument.split(replacement).join(line)),
    }));
}

function splitWords(input: string): string[] {
  const words: string[] = [];
  let word = '';
  let quote = '';
  let started = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quote === "'") {
      if (character === "'") quote = '';
      else word += character;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      if (index + 1 < input.length) word += input[++index];
      started = true;
      continue;
    }
    if (quote === '"') {
      if (character === '"') quote = '';
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started) words.push(word);
      word = '';
      started = false;
      continue;
    }
    word += character;
    started = true;
  }
  if (started) words.push(word);
  return words;
}

export function formatXargsTrace(invocation: XargsInvocation): string {
  return [invocation.command, ...invocation.args].map(quoteArgument).join(' ');
}

function quoteArgument(argument: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(argument)) return argument;
  return `'${argument.replace(/'/g, "'\\''")}'`;
}
