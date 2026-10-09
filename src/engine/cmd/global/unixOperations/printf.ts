import { UnixCommandBase } from './base';

type FormatSpec = {
  flags: string;
  width: number;
  precision: number | undefined;
  conversion: string;
};

export class PrintfCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length === 0) throw new Error('printf: missing format string');
    const format = expandFormatEscapes(args[0]);
    const operands = args.slice(1);
    let operandIndex = 0;
    let output = '';
    let consumed = false;

    while (!consumed || operandIndex < operands.length) {
      consumed = true;
      const rendered = renderFormat(format, operands, operandIndex);
      output += rendered.text;
      operandIndex = rendered.operandIndex;
      if (rendered.conversions === 0 || rendered.stop) {
        break;
      }
    }
    return output;
  }
}

function renderFormat(
  format: string,
  operands: string[],
  initialOperandIndex: number
): { text: string; operandIndex: number; conversions: number; stop: boolean } {
  let text = '';
  let operandIndex = initialOperandIndex;
  let conversions = 0;
  let stop = false;

  for (let index = 0; index < format.length; index += 1) {
    if (format[index] !== '%') {
      text += format[index];
      continue;
    }
    if (format[index + 1] === '%') {
      text += '%';
      index += 1;
      continue;
    }
    const parsed = parseFormatSpec(format, index);
    if (parsed.spec === null) throw new Error(`printf: invalid format: ${format.slice(index)}`);
    index = parsed.end;
    const value = operands[operandIndex] ?? '';
    if (parsed.spec.conversion !== '%') operandIndex += 1;
    if (parsed.spec.conversion === 'b') {
      const expanded = expandOperandEscapes(value);
      text += expanded.text;
      conversions += 1;
      if (expanded.stop) {
        stop = true;
        break;
      }
      continue;
    }
    text += formatOperand(value, parsed.spec);
    conversions += 1;
  }
  return { text, operandIndex, conversions, stop };
}

function parseFormatSpec(format: string, start: number): { spec: FormatSpec | null; end: number } {
  const match = /^%([-+#0 ']*)(\d*)(?:\.(\d*))?([diuoxXfFeEgGcsb])/.exec(format.slice(start));
  if (!match) return { spec: null, end: start };
  let width = 0;
  if (match[2] !== '') width = Number(match[2]);
  let precision: number | undefined;
  if (match[3] !== undefined) {
    precision = 0;
    if (match[3] !== '') precision = Number(match[3]);
  }
  return {
    spec: {
      flags: match[1],
      width,
      precision,
      conversion: match[4],
    },
    end: start + match[0].length - 1,
  };
}

function formatOperand(value: string, spec: FormatSpec): string {
  let rendered: string;
  const conversion = spec.conversion;
  if (conversion === 's') {
    rendered = value;
    if (spec.precision !== undefined) rendered = [...value].slice(0, spec.precision).join('');
  } else if (conversion === 'c') {
    const characters = [...value];
    rendered = characters[0] ?? '\0';
  } else if ('diuoxX'.includes(conversion)) {
    rendered = formatInteger(value, spec);
  } else {
    rendered = formatFloat(value, spec);
  }
  return applyWidth(rendered, spec);
}

function formatInteger(value: string, spec: FormatSpec): string {
  const number = parseNumericOperand(value);
  if (!Number.isFinite(number)) throw new Error(`printf: ${value}: invalid number`);
  const conversion = spec.conversion;
  let integer = BigInt(Math.trunc(number));
  if ('uoxX'.includes(conversion)) integer = BigInt.asUintN(64, integer);
  const magnitude = integer < 0n ? -integer : integer;
  let result = magnitude.toString(10);
  if (conversion === 'o') result = magnitude.toString(8);
  if (conversion === 'x') result = magnitude.toString(16);
  if (conversion === 'X') result = magnitude.toString(16).toUpperCase();
  if (spec.precision === 0 && integer === 0n) result = '';
  if (spec.precision !== undefined) result = result.padStart(spec.precision, '0');
  let sign = '';
  if (!'uoxX'.includes(conversion)) {
    if (integer < 0n) sign = '-';
    else if (spec.flags.includes('+')) sign = '+';
    else if (spec.flags.includes(' ')) sign = ' ';
  }
  if (spec.flags.includes('#') && conversion === 'o' && !result.startsWith('0'))
    result = `0${result}`;
  if (spec.flags.includes('#') && (conversion === 'x' || conversion === 'X') && integer !== 0n) {
    let prefix = '0X';
    if (conversion === 'x') prefix = '0x';
    result = `${prefix}${result}`;
  }
  return `${sign}${result}`;
}

function formatFloat(value: string, spec: FormatSpec): string {
  const number = parseNumericOperand(value);
  if (!Number.isFinite(number)) throw new Error(`printf: ${value}: invalid number`);
  let precision = spec.precision ?? 6;
  if (precision === 0 && 'gG'.includes(spec.conversion)) precision = 1;
  let rendered: string;
  if ('fF'.includes(spec.conversion)) rendered = number.toFixed(precision);
  else if ('eE'.includes(spec.conversion))
    rendered = normalizeExponent(number.toExponential(precision));
  else rendered = formatGeneral(number, precision, spec.flags.includes('#'));
  if (Object.is(number, -0)) rendered = `-${rendered}`;
  if (spec.conversion === spec.conversion.toUpperCase()) rendered = rendered.toUpperCase();
  if (spec.flags.includes('#') && !rendered.includes('.') && !'gG'.includes(spec.conversion)) {
    const exponent = /[eE][+-]?\d+$/.exec(rendered);
    if (exponent) rendered = `${rendered.slice(0, exponent.index)}.${exponent[0]}`;
    else rendered += '.';
  }
  let sign = '';
  if (!rendered.startsWith('-') && spec.flags.includes('+')) sign = '+';
  else if (!rendered.startsWith('-') && spec.flags.includes(' ')) sign = ' ';
  return `${sign}${rendered}`;
}

function formatGeneral(number: number, precision: number, alternate: boolean): string {
  if (number === 0) {
    if (!alternate) return '0';
    if (precision < 2) return '0.';
    return `0.${'0'.repeat(precision - 1)}`;
  }
  const exponent = Math.floor(Math.log10(Math.abs(number)));
  let result: string;
  if (exponent < -4 || exponent >= precision) {
    result = normalizeExponent(number.toExponential(precision - 1));
    if (!alternate) result = trimMantissa(result);
    else result = ensureMantissaPoint(result);
    return result;
  }
  const decimalPlaces = Math.max(0, precision - exponent - 1);
  result = number.toFixed(decimalPlaces);
  if (!alternate) result = result.replace(/\.?0+$/, '');
  else if (!result.includes('.')) result += '.';
  return result;
}

function normalizeExponent(value: string): string {
  const match = /^(.*)e([+-])(\d+)$/.exec(value);
  if (!match) return value;
  return `${match[1]}e${match[2]}${match[3].padStart(2, '0')}`;
}

function trimMantissa(value: string): string {
  const exponent = value.indexOf('e');
  const mantissa = value.slice(0, exponent).replace(/\.?0+$/, '');
  return `${mantissa}${value.slice(exponent)}`;
}

function ensureMantissaPoint(value: string): string {
  const exponent = value.indexOf('e');
  const mantissa = value.slice(0, exponent);
  if (mantissa.includes('.')) return value;
  return `${mantissa}.${value.slice(exponent)}`;
}

function applyWidth(value: string, spec: FormatSpec): string {
  if (value.length >= spec.width) return value;
  const padding = ' '.repeat(spec.width - value.length);
  if (spec.flags.includes('-')) return `${value}${padding}`;
  const numeric = 'diuoxXfFeEgG'.includes(spec.conversion);
  const floating = 'fFeEgG'.includes(spec.conversion);
  const integerPrecisionAllowsZero = floating || spec.precision === undefined;
  if (spec.flags.includes('0') && integerPrecisionAllowsZero && numeric) {
    let sign = '';
    let remainder = value;
    if (value[0] === '-' || value[0] === '+' || value[0] === ' ') {
      sign = value[0];
      remainder = value.slice(1);
    }
    let prefix = '';
    if (remainder.startsWith('0x') || remainder.startsWith('0X')) {
      prefix = remainder.slice(0, 2);
      remainder = remainder.slice(2);
    }
    return `${sign}${prefix}${'0'.repeat(padding.length)}${remainder}`;
  }
  return `${padding}${value}`;
}

function parseNumericOperand(value: string): number {
  if (value.trim() === '') return 0;
  return Number(value);
}

function expandFormatEscapes(text: string): string {
  return expandEscapes(text, false).text;
}

function expandOperandEscapes(text: string): { text: string; stop: boolean } {
  return expandEscapes(text, true);
}

function expandEscapes(text: string, stopAtControl: boolean): { text: string; stop: boolean } {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\' || index + 1 >= text.length) {
      output += text[index];
      continue;
    }
    const escapeCode = text[index + 1];
    if (escapeCode === 'c' && stopAtControl) return { text: output, stop: true };
    const simple: Record<string, string> = {
      '\\': '\\',
      a: '\x07',
      b: '\b',
      e: '\x1b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
    };
    if (simple[escapeCode] !== undefined) {
      output += simple[escapeCode];
      index += 1;
      continue;
    }
    if (escapeCode === 'x') {
      const hex = text.slice(index + 2, index + 4).match(/^[0-9a-fA-F]{1,2}/)?.[0] ?? '';
      if (hex) {
        output += String.fromCodePoint(Number.parseInt(hex, 16));
        index += 1 + hex.length;
        continue;
      }
    }
    if (escapeCode >= '0' && escapeCode <= '7') {
      const octal = text.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? '';
      output += String.fromCodePoint(Number.parseInt(octal, 8));
      index += octal.length;
      continue;
    }
    output += `\\${escapeCode}`;
    index += 1;
  }
  return { text: output, stop: false };
}
