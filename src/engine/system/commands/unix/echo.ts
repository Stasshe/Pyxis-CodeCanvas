import { UnixCommandBase } from './base';

export class EchoCommand extends UnixCommandBase {
  async execute(args: string[]): Promise<string> {
    let index = 0;
    let noNewline = false;
    let interpretEscapes = false;

    while (index < args.length) {
      const option = args[index];
      if (!/^-[neE]+$/.test(option)) break;
      for (const flag of option.slice(1)) {
        if (flag === 'n') noNewline = true;
        if (flag === 'e') interpretEscapes = true;
        if (flag === 'E') interpretEscapes = false;
      }
      index += 1;
    }

    const text = args.slice(index).join(' ');
    let expanded = { text, stop: false };
    if (interpretEscapes) expanded = expandEchoEscapes(text);
    if (noNewline || expanded.stop) return expanded.text;
    return `${expanded.text}\n`;
  }
}

function expandEchoEscapes(text: string): { text: string; stop: boolean } {
  let output = '';
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] !== '\\' || index + 1 >= text.length) {
      output += text[index];
      continue;
    }
    const escapeCode = text[index + 1];
    if (escapeCode === 'c') return { text: output, stop: true };
    const simple: Record<string, string> = {
      a: '\x07',
      b: '\b',
      e: '\x1b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t',
      v: '\v',
      '\\': '\\',
    };
    const replacement = simple[escapeCode];
    if (replacement !== undefined) {
      output += replacement;
      index += 1;
      continue;
    }
    if (escapeCode === '0') {
      const octal = text.slice(index + 2, index + 5).match(/^[0-7]{1,3}/)?.[0] ?? '';
      output += String.fromCodePoint(Number.parseInt(octal || '0', 8));
      index += 1 + octal.length;
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
    output += `\\${escapeCode}`;
    index += 1;
  }
  return { text: output, stop: false };
}
