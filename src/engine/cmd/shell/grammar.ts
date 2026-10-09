import { ParseError } from './errors';
import type { Lexeme } from './syntax';
import type { CompoundCommand } from './types';

const controlWords = new Set(['if', 'for', 'while']);
const unsupportedWords = new Set(['until', 'select', 'case']);
const closingWords = new Set(['then', 'elif', 'else', 'fi', 'do', 'done']);
const separators = new Set([';', '\n', '&', '|', '&&', '||']);

/** Reserved words are recognized only at command boundaries, never inside arguments. */
export function groupControlCommands(source: string, lexemes: Lexeme[]): Lexeme[] {
  let cursor = 0;
  const word = () => {
    const token = lexemes[cursor];
    if (token?.kind === 'word') return token.source;
    return undefined;
  };
  const skipSeparators = () => {
    while (lexemes[cursor]?.kind === 'operator' && [';', '\n'].includes(lexemes[cursor].source))
      cursor++;
  };
  const expectWord = (expected: string) => {
    if (word() !== expected) throw new ParseError(`Expected ${expected}`, lexemes[cursor]?.start);
    return lexemes[cursor++];
  };
  const slice = (start: number, end: number) => source.slice(start, end).trim();
  const list = (stops: Set<string>): string => {
    const start = lexemes[cursor]?.start ?? source.length;
    let boundary = true;
    let count = 0;
    let target = false;
    while (cursor < lexemes.length) {
      const token = lexemes[cursor];
      if (boundary && !target && token.kind === 'word') {
        if (stops.has(token.source)) break;
        if (controlWords.has(token.source)) {
          command();
          boundary = false;
          count++;
          continue;
        }
        if (unsupportedWords.has(token.source))
          throw new ParseError(`Unsupported ${token.source} command`, token.start);
        if (closingWords.has(token.source))
          throw new ParseError(`Unexpected ${token.source}`, token.start);
      }
      cursor++;
      target = token.kind === 'operator' && /^[<>]|^&>/.test(token.source);
      if (token.kind === 'operator' && separators.has(token.source)) boundary = true;
      else if (token.kind !== 'operator') {
        if (!(boundary && token.source === '!')) boundary = false;
        count++;
      }
    }
    if (count === 0) throw new ParseError('Expected command list', start);
    return slice(start, lexemes[cursor]?.start ?? source.length);
  };
  const command = (): Lexeme => {
    const opening = lexemes[cursor++];
    const kind = opening.source;
    let control: CompoundCommand;
    let closing: Lexeme;
    if (kind === 'if') {
      const branches: Array<{ condition: string; body: string }> = [];
      let otherwise: string | undefined;
      while (true) {
        const condition = list(new Set(['then']));
        expectWord('then');
        const body = list(new Set(['elif', 'else', 'fi']));
        branches.push({ condition, body });
        if (word() !== 'elif') break;
        cursor++;
      }
      if (word() === 'else') {
        cursor++;
        otherwise = list(new Set(['fi']));
      }
      closing = expectWord('fi');
      control = { kind: 'if', source: slice(opening.start, closing.end), branches, otherwise };
    } else if (kind === 'for') {
      const variable = word();
      if (!variable || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
        throw new ParseError(
          'Expected for variable (arithmetic for is unsupported)',
          opening.start
        );
      cursor++;
      let items: string | undefined;
      if (word() === 'in') {
        cursor++;
        const start = lexemes[cursor]?.start ?? source.length;
        while (lexemes[cursor]?.kind === 'word') cursor++;
        items = slice(start, lexemes[cursor]?.start ?? source.length);
      }
      if (lexemes[cursor]?.kind !== 'operator' || ![';', '\n'].includes(lexemes[cursor].source))
        throw new ParseError('Expected separator before do', lexemes[cursor]?.start);
      skipSeparators();
      expectWord('do');
      const body = list(new Set(['done']));
      closing = expectWord('done');
      control = { kind: 'for', source: slice(opening.start, closing.end), variable, items, body };
    } else {
      const condition = list(new Set(['do']));
      expectWord('do');
      const body = list(new Set(['done']));
      closing = expectWord('done');
      control = { kind: 'while', source: slice(opening.start, closing.end), condition, body };
    }
    return {
      kind: 'compound',
      source: control.source,
      body: control.source,
      subshell: false,
      control,
      start: opening.start,
      end: closing.end,
    };
  };
  const result: Lexeme[] = [];
  let boundary = true;
  let target = false;
  while (cursor < lexemes.length) {
    const token = lexemes[cursor];
    if (boundary && !target && token.kind === 'word') {
      if (controlWords.has(token.source)) {
        result.push(command());
        boundary = false;
        continue;
      }
      if (unsupportedWords.has(token.source))
        throw new ParseError(`Unsupported ${token.source} command`, token.start);
      if (closingWords.has(token.source))
        throw new ParseError(`Unexpected ${token.source}`, token.start);
    }
    result.push(token);
    cursor++;
    target = token.kind === 'operator' && /^[<>]|^&>/.test(token.source);
    if (token.kind === 'operator' && separators.has(token.source)) boundary = true;
    else if (!(boundary && token.source === '!')) boundary = false;
  }
  return result;
}
