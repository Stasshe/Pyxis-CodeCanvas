import { parseWithGetOpt } from '../../shell/lib/index';
import { UnixCommandBase, UnixCommandFailure } from './base';

export class HeadCommand extends UnixCommandBase {
  async execute(args: string[], stdin?: string | Uint8Array): Promise<string | Uint8Array> {
    const normalizedArgs = normalizeArguments(args);
    const { flags, orderedOptions, positional, errors } = parseWithGetOpt(
      normalizedArgs,
      'n:c:qv',
      ['lines=', 'bytes=', 'quiet', 'verbose', 'silent', 'help']
    );
    if (errors.length > 0) throw new Error(errors.join('; '));
    if (flags.has('--help')) return 'Usage: head [OPTION]... [FILE]...';
    if (positional.length === 0 && stdin === undefined)
      throw new Error('head: missing file operand');

    let count = 10;
    let countBytes = false;
    let fromEnd = false;
    let headerMode: 'quiet' | 'verbose' | null = null;
    for (const option of orderedOptions) {
      if (option.option === 'n' || option.option === 'lines') {
        count = parseCount(option.argument ?? undefined, 'lines') ?? 10;
        countBytes = false;
        fromEnd = option.argument?.startsWith('-') === true;
      }
      if (option.option === 'c' || option.option === 'bytes') {
        count = parseCount(option.argument ?? undefined, 'bytes') ?? 10;
        countBytes = true;
        fromEnd = option.argument?.startsWith('-') === true;
      }
      if (option.option === 'q' || option.option === 'quiet' || option.option === 'silent') {
        headerMode = 'quiet';
      }
      if (option.option === 'v' || option.option === 'verbose') headerMode = 'verbose';
    }
    let showHeader = positional.length > 1;
    if (headerMode === 'quiet') showHeader = false;
    if (headerMode === 'verbose') showHeader = true;

    if (positional.length === 0) {
      const input = toBytes(stdin ?? '');
      const output = select(input, count, countBytes, fromEnd);
      if (showHeader) return concatenate(["==> 'standard input' <==\n", output]);
      return output;
    }

    const outputs: Array<string | Uint8Array> = [];
    const failures: string[] = [];
    let stdinRead = false;
    let hasOutput = false;
    for (const [index, file] of positional.entries()) {
      try {
        let input: Uint8Array;
        if (file === '-') {
          if (stdinRead) input = new Uint8Array();
          else input = toBytes(stdin ?? '');
          stdinRead = true;
        } else {
          const path = this.resolvePath(file);
          const entry = await this.getFile(path);
          if (!entry) throw new Error('No such file or directory');
          if (entry.type === 'folder') throw new Error('Is a directory');
          input = await this.readBytes(path);
        }
        const output = select(input, count, countBytes, fromEnd);
        if (showHeader) {
          if (index > 0 && hasOutput) outputs.push('\n');
          let displayName = file;
          if (file === '-') displayName = "'standard input'";
          outputs.push(`==> ${displayName} <==\n`);
          hasOutput = true;
        }
        outputs.push(output);
        const outputBytes = toBytes(output);
        if (outputBytes.length > 0) hasOutput = true;
      } catch (error) {
        let message = String(error);
        if (error instanceof Error) message = error.message;
        failures.push(`head: ${file}: ${message}`);
      }
    }

    const outputBytes = concatenate(outputs);
    if (failures.length > 0) throw new UnixCommandFailure(failures.join('\n'), 1, outputBytes);
    return outputBytes;
  }
}

function normalizeArguments(args: string[]): string[] {
  const normalized: string[] = [];
  let optionsEnded = false;
  for (const argument of args) {
    if (optionsEnded) {
      normalized.push(argument);
      continue;
    }
    if (argument === '--') {
      normalized.push(argument);
      optionsEnded = true;
      continue;
    }
    const previous = normalized[normalized.length - 1];
    const previousExpectsValue =
      previous === '-n' || previous === '--lines' || previous === '-c' || previous === '--bytes';
    if (/^-\d+$/.test(argument) && !previousExpectsValue) {
      normalized.push('-n', argument.slice(1));
      continue;
    }
    normalized.push(argument);
  }
  return normalized;
}

function parseCount(value: string | undefined, unit: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[+-]?\d+$/.test(value)) throw new Error(`head: invalid number of ${unit}: '${value}'`);
  return Math.abs(Number(value));
}

function select(input: Uint8Array, count: number, bytes: boolean, fromEnd: boolean): Uint8Array {
  if (bytes) {
    if (fromEnd && count === 0) return input;
    if (fromEnd) return input.slice(0, Math.max(0, input.length - count));
    return input.slice(0, count);
  }
  const lineEnds = getLineEnds(input);
  if (fromEnd && count === 0) return input;
  let retainedLines = count;
  if (fromEnd) retainedLines = Math.max(0, lineEnds.length - count);
  if (retainedLines === 0) return input.slice(0, 0);
  const end = lineEnds[Math.min(retainedLines, lineEnds.length) - 1];
  if (end === undefined) return input;
  return input.slice(0, end);
}

function getLineEnds(input: Uint8Array): number[] {
  const lineEnds: number[] = [];
  for (let index = 0; index < input.length; index += 1) {
    if (input[index] === 10) lineEnds.push(index + 1);
  }
  if (input.length > 0 && input[input.length - 1] !== 10) lineEnds.push(input.length);
  return lineEnds;
}

function toBytes(input: string | Uint8Array): Uint8Array {
  if (input instanceof Uint8Array) return input;
  return new TextEncoder().encode(input);
}

function concatenate(values: Array<string | Uint8Array>): Uint8Array {
  const chunks = values.map(toBytes);
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
