import { parseWithGetOpt } from '../../shell/lib/index';
import { UnixCommandBase } from './base';

const encoder = new TextEncoder();

export class SortCommand extends UnixCommandBase {
  private stdinContent: string | null = null;

  setStdin(content: string | null): void {
    this.stdinContent = content;
  }

  async execute(args: string[] = []): Promise<string> {
    const optstring = 'rnu';
    const longopts: string[] = ['help'];
    const { flags, positional, errors } = parseWithGetOpt(args, optstring, longopts);
    if (errors.length) throw new Error(errors.join('; '));

    if (flags.has('--help')) {
      return `Usage: sort [options] [file...]
Options:
  -r	reverse
  -n	numeric
  -u	unique`;
    }

    const reverse = flags.has('-r');
    const numeric = flags.has('-n');
    const unique = flags.has('-u');

    let lines: string[] = [];

    if (positional.length === 0) {
      lines = splitLines(this.stdinContent ?? '');
    } else {
      for (const p of positional) {
        if (p === '-') {
          lines = lines.concat(splitLines(this.stdinContent ?? ''));
          continue;
        }
        const resolved = this.resolvePath(p);
        const file = await this.getFile(resolved);
        if (!file) throw new Error(`sort: ${p}: No such file or directory`);
        if (file.type === 'folder') throw new Error(`sort: ${p}: Is a directory`);
        const content = await this.readText(resolved);
        lines = lines.concat(splitLines(content));
      }
    }

    let comparePrimary: (left: string, right: string) => number = compareBytes;
    if (numeric) comparePrimary = compareNumbers;

    lines.sort((a, b) => {
      const primaryOrder = comparePrimary(a, b);
      if (unique && primaryOrder === 0) return 0;
      const order = primaryOrder || compareBytes(a, b);
      if (order === 0 || !reverse) return order;
      return -order;
    });
    if (unique) {
      lines = lines.filter(
        (line, index) => index === 0 || comparePrimary(lines[index - 1], line) !== 0
      );
    }

    if (lines.length === 0) return '';
    return `${lines.join('\n')}\n`;
  }
}

function compareBytes(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const sharedLength = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < sharedLength; index += 1) {
    if (leftBytes[index] !== rightBytes[index]) return leftBytes[index] - rightBytes[index];
  }
  return leftBytes.length - rightBytes.length;
}

interface DecimalParts {
  negative: boolean;
  integer: string;
  fraction: string;
}

function parseDecimal(line: string): DecimalParts {
  const match = /^[ \t]*(-?)(\d*)(?:\.(\d*))?/.exec(line);
  if (!match || (match[2].length === 0 && (match[3] ?? '').length === 0)) {
    return { negative: false, integer: '0', fraction: '' };
  }
  const integer = (match[2] || '0').replace(/^0+/, '') || '0';
  const fraction = (match[3] ?? '').replace(/0+$/, '');
  const isZero = integer === '0' && fraction.length === 0;
  return { negative: match[1] === '-' && !isZero, integer, fraction };
}

function splitLines(content: string): string[] {
  const lines = content.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

function compareNumbers(left: string, right: string): number {
  const leftNumber = parseDecimal(left);
  const rightNumber = parseDecimal(right);
  if (leftNumber.negative !== rightNumber.negative) {
    if (leftNumber.negative) return -1;
    return 1;
  }
  let sign = 1;
  if (leftNumber.negative) sign = -1;
  if (leftNumber.integer.length !== rightNumber.integer.length) {
    return (leftNumber.integer.length - rightNumber.integer.length) * sign;
  }
  const integerOrder = compareBytes(leftNumber.integer, rightNumber.integer);
  if (integerOrder !== 0) return integerOrder * sign;
  const fractionLength = Math.max(leftNumber.fraction.length, rightNumber.fraction.length);
  const fractionOrder = compareBytes(
    leftNumber.fraction.padEnd(fractionLength, '0'),
    rightNumber.fraction.padEnd(fractionLength, '0')
  );
  return fractionOrder * sign;
}
