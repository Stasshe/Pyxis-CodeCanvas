import { UnixCommandBase } from './base';

type Decimal = { coefficient: bigint; scale: number };

export class SeqCommand extends UnixCommandBase {
  execute(args: string[]): string {
    const parsed = parseArguments(args);
    if (parsed.values.length < 1 || parsed.values.length > 3) {
      throw new Error('seq: invalid number of arguments');
    }
    const values = parsed.values.map(parseDecimal);
    let start = decimal(1n, 0);
    let step = decimal(1n, 0);
    let end = values[0];
    if (values.length === 2) [start, end] = values;
    if (values.length === 3) [start, step, end] = values;

    const scale = Math.max(start.scale, step.scale, end.scale);
    const startValue = align(start, scale);
    const stepValue = align(step, scale);
    const endValue = align(end, scale);
    if (stepValue === 0n) throw new Error('seq: increment must not be zero');

    const output: string[] = [];
    for (let value = startValue; within(value, endValue, stepValue); value += stepValue) {
      output.push(formatDecimal(value, scale));
    }
    if (output.length === 0) return '';
    return `${output.join(parsed.separator)}\n`;
  }
}

function parseArguments(args: string[]): { separator: string; values: string[] } {
  let separator = '\n';
  const values: string[] = [];
  let optionsEnded = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!optionsEnded && argument === '--') {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && (argument === '-s' || argument === '--separator')) {
      const value = args[index + 1];
      if (value === undefined) throw new Error(`seq: option '${argument}' requires an argument`);
      separator = value;
      index += 1;
      continue;
    }
    if (!optionsEnded && argument.startsWith('-s') && argument.length > 2) {
      separator = argument.slice(2);
      continue;
    }
    if (!optionsEnded && argument.startsWith('--separator=')) {
      separator = argument.slice('--separator='.length);
      continue;
    }
    values.push(argument);
  }
  return { separator, values };
}

function parseDecimal(value: string): Decimal {
  const match = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(value);
  if (!match) throw new Error(`seq: invalid number: ${value}`);
  const fraction = match[3] ?? match[4] ?? '';
  const exponent = Number(match[5] ?? '0');
  if (!Number.isSafeInteger(exponent)) throw new Error(`seq: invalid number: ${value}`);
  const digits = `${match[2] ?? '0'}${fraction}`;
  let coefficient = BigInt(digits);
  if (match[1] === '-') coefficient *= -1n;
  let scale = fraction.length - exponent;
  if (scale < 0) {
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  return { coefficient, scale };
}

function decimal(coefficient: bigint, scale: number): Decimal {
  return { coefficient, scale };
}

function align(value: Decimal, scale: number): bigint {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

function within(value: bigint, end: bigint, step: bigint): boolean {
  if (step > 0n) return value <= end;
  return value >= end;
}

function formatDecimal(value: bigint, scale: number): string {
  const negative = value < 0n;
  let magnitude = value;
  if (negative) magnitude = -value;
  const digits = magnitude.toString().padStart(scale + 1, '0');
  let sign = '';
  if (negative) sign = '-';
  if (scale === 0) return `${sign}${digits}`;
  const split = digits.length - scale;
  return `${sign}${digits.slice(0, split)}.${digits.slice(split)}`;
}
