import { UnixCommandBase } from './base';

export class PrintfCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    if (args.length === 0) throw new Error('printf: missing format string');

    const format = interpretEscapes(args[0]);
    const operands = args.slice(1);
    let operandIndex = 0;
    let output = '';
    let conversions: number;

    do {
      conversions = 0;
      let formatted = '';
      for (let index = 0; index < format.length; index += 1) {
        if (format[index] !== '%') {
          formatted += format[index];
          continue;
        }

        const conversion = format[index + 1];
        if (conversion === '%') {
          formatted += '%';
          index += 1;
          continue;
        }
        if (conversion !== 'b' && conversion !== 'd' && conversion !== 's') {
          throw new Error(`printf: invalid format: %${conversion ?? ''}`);
        }

        conversions += 1;
        const operand = operands[operandIndex++];
        if (conversion === 'b') {
          formatted += interpretEscapes(operand ?? '');
        } else if (conversion === 'd') {
          const value = operand === undefined ? 0 : Number.parseInt(operand, 10);
          if (Number.isNaN(value)) throw new Error(`printf: invalid number: ${operand}`);
          formatted += String(value);
        } else {
          formatted += operand ?? '';
        }
        index += 1;
      }
      output += formatted;
    } while (conversions > 0 && operandIndex < operands.length);

    return output;
  }
}

function interpretEscapes(text: string): string {
  return text.replace(/\\([\\abefnrtv])/g, (_match, escapeSequence: string) => {
    const escapes: Record<string, string> = {
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
    return escapes[escapeSequence];
  });
}
