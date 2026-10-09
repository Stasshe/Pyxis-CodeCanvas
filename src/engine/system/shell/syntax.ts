import { ParseError } from './errors';
import { groupControlCommands } from './grammar';
import { readHeredocHeader } from './heredoc';
import { readAnsiCQuote } from './parameter';
import type { CompoundCommand } from './types';

export type Lexeme =
  | { kind: 'word'; source: string; start: number; end: number }
  | { kind: 'operator'; source: string; start: number; end: number }
  | {
      kind: 'compound';
      source: string;
      body: string;
      subshell: boolean;
      functionName?: string;
      control?: CompoundCommand;
      start: number;
      end: number;
    };

function skipDocuments(source: string, newline: number): number {
  const lineStart = source.lastIndexOf('\n', newline - 1) + 1;
  const specifications = readHeredocHeader(source.slice(lineStart, newline));
  let cursor = newline + 1;
  for (const specification of specifications) {
    while (cursor < source.length) {
      let end = source.indexOf('\n', cursor);
      if (end < 0) end = source.length;
      let line = source.slice(cursor, end);
      if (specification.stripTabs) line = line.replace(/^\t+/, '');
      cursor = Math.min(end + 1, source.length);
      if (line === specification.delimiter) break;
    }
  }
  return cursor;
}

function readQuote(source: string, start: number): number {
  const quote = source[start];
  for (let index = start + 1; index < source.length; index++) {
    if (source[index] === '\\' && quote !== "'") {
      index++;
      continue;
    }
    if (source[index] === quote) return index + 1;
    if (quote === '"' && source[index] === '`') {
      index = readQuote(source, index) - 1;
      continue;
    }
    if (
      quote === '"' &&
      source[index] === '$' &&
      (source[index + 1] === '(' || source[index + 1] === '{')
    ) {
      index = readBalanced(source, index + 1) - 1;
    }
  }
  throw new ParseError('Unterminated quote', start);
}

export function readBalanced(source: string, start: number): number {
  const opening = source[start];
  let closing = ')';
  if (opening === '{') closing = '}';
  let depth = 1;
  for (let index = start + 1; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === '#' && (index === 0 || /[\s;|&]/.test(source[index - 1]))) {
      while (index < source.length && source[index] !== '\n') index++;
    }
    if (source[index] === '\n') {
      index = skipDocuments(source, index) - 1;
      continue;
    }
    if (character === '$' && source[index + 1] === "'") {
      index = readAnsiCQuote(source, index).end - 1;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      index = readQuote(source, index) - 1;
      continue;
    }
    if (character === '$' && (source[index + 1] === '(' || source[index + 1] === '{')) {
      index = readBalanced(source, index + 1) - 1;
      continue;
    }
    if (
      character === opening &&
      (opening !== '{' || source[start - 1] === '$' || reservedBrace(source, index))
    )
      depth++;
    if (
      character === closing &&
      (opening !== '{' || source[start - 1] === '$' || reservedBrace(source, index))
    ) {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  throw new ParseError(`Unterminated ${opening} command`, start);
}

function reservedBrace(source: string, index: number): boolean {
  const preceding = source[index - 1];
  const following = source[index + 1];
  return (
    (preceding === undefined || /[\s;|&()]/.test(preceding)) &&
    (following === undefined || /[\s;|&<>()]/.test(following))
  );
}

export function lexShell(source: string, controls = true): Lexeme[] {
  const lexemes: Lexeme[] = [];
  let index = 0;
  let commandStart = controls;
  while (index < source.length) {
    const character = source[index];
    if (character === ' ' || character === '\t' || character === '\r') {
      index++;
      continue;
    }
    if (character === '#') {
      while (index < source.length && source[index] !== '\n') index++;
      continue;
    }
    const start = index;
    if (commandStart) {
      const definition =
        /^(?:function\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*\)\s*\{|^function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/.exec(
          source.slice(index)
        );
      if (definition) {
        const opening = index + definition[0].lastIndexOf('{');
        index = readBalanced(source, opening);
        lexemes.push({
          kind: 'compound',
          source: source.slice(start, index),
          body: source.slice(opening + 1, index - 1),
          subshell: false,
          functionName: definition[1] ?? definition[2],
          start,
          end: index,
        });
        commandStart = false;
        continue;
      }
    }
    if (
      commandStart &&
      (character === '(' || (character === '{' && reservedBrace(source, index)))
    ) {
      index = readBalanced(source, index);
      lexemes.push({
        kind: 'compound',
        source: source.slice(start, index),
        body: source.slice(start + 1, index - 1),
        subshell: character === '(',
        start,
        end: index,
      });
      commandStart = false;
      continue;
    }
    if (character === ')' || (character === '}' && reservedBrace(source, index))) {
      throw new ParseError(`Unexpected ${character}`, index);
    }
    const processSubstitution =
      (character === '<' || character === '>') && source[index + 1] === '(';
    if ('|&;<>\n'.includes(character) && !processSubstitution) {
      if (character === '\n') {
        const afterDocuments = skipDocuments(source, index);
        if (afterDocuments > index + 1) {
          index = afterDocuments;
          lexemes.push({ kind: 'operator', source: '\n', start: index, end: index });
          commandStart = true;
          continue;
        }
      }
      let operator = character;
      const following = source[index + 1];
      if (
        (character === '|' || character === '&' || character === '>' || character === '<') &&
        following === character
      ) {
        operator += following;
        if (operator === '<<' && source[index + 2] === '-') operator += '-';
      } else if ((character === '>' || character === '<') && following === '&') {
        operator += following;
      } else if (character === '&' && following === '>') {
        operator += following;
        if (source[index + 2] === '>') operator += '>';
      }
      index += operator.length;
      lexemes.push({ kind: 'operator', source: operator, start, end: index });
      commandStart = '|&;\n'.includes(character);
      continue;
    }
    while (index < source.length) {
      const current = source[index];
      if (current === '\\') {
        index += 2;
        continue;
      }
      if (current === '$' && source[index + 1] === "'") {
        index = readAnsiCQuote(source, index).end;
        continue;
      }
      if (current === "'" || current === '"' || current === '`') {
        index = readQuote(source, index);
        continue;
      }
      if (current === '$' && (source[index + 1] === '(' || source[index + 1] === '{')) {
        index = readBalanced(source, index + 1);
        continue;
      }
      if ((current === '<' || current === '>') && source[index + 1] === '(') {
        index = readBalanced(source, index + 1);
        continue;
      }
      if (current === '(' && /^[A-Za-z_][A-Za-z0-9_]*=$/.test(source.slice(start, index))) {
        index = readBalanced(source, index);
        continue;
      }
      if (/[\s|&;<>]/.test(current) || current === '(' || current === ')') break;
      index++;
    }
    if (index === start) throw new ParseError(`Unexpected ${source[index]}`, index);
    lexemes.push({ kind: 'word', source: source.slice(start, index), start, end: index });
    commandStart =
      commandStart &&
      ['if', 'then', 'elif', 'else', 'while', 'do', '!'].includes(source.slice(start, index));
  }
  if (controls) return groupControlCommands(source, lexemes);
  return lexemes;
}

export function splitStatements(
  source: string,
  separators: 'lines' | 'statements' = 'statements'
): string[] {
  const statements: string[] = [];
  let start = 0;
  let continuation = false;
  for (const lexeme of lexShell(source)) {
    if (lexeme.kind !== 'operator') {
      continuation = false;
      continue;
    }
    if (lexeme.source === '|' || lexeme.source === '&&' || lexeme.source === '||')
      continuation = true;
    if (lexeme.source === '\n' && continuation) continue;
    if (lexeme.source !== '\n' && (lexeme.source !== ';' || separators === 'lines')) continue;
    statements.push(source.slice(start, lexeme.start));
    start = lexeme.end;
  }
  if (start < source.length) statements.push(source.slice(start));
  return statements;
}
