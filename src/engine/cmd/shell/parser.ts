import { ParseError } from './errors';
import { readHeredocDocument } from './heredoc';
import { readAnsiCQuote } from './parameter';
import { type Lexeme, lexShell, readBalanced } from './syntax';
import type { Segment as CommandSegment, TokenObj } from './types';

export { ParseError } from './errors';
export type Token = TokenObj;
export type Segment = Omit<CommandSegment, 'tokens'> & { tokens: Token[] };

export function makeShellToken(raw: string): Token {
  let quote: Token['quote'] = null;
  let activeQuote: Token['quote'] = null;
  let text = '';
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '$' && raw[index + 1] === "'" && activeQuote === null) {
      const ansi = readAnsiCQuote(raw, index);
      text += ansi.value;
      quote = 'single';
      index = ansi.end - 1;
      continue;
    }
    if (character === "'" && activeQuote !== 'double') {
      if (activeQuote === 'single') activeQuote = null;
      else activeQuote = 'single';
      if (quote === null) quote = 'single';
      continue;
    }
    if (character === '"' && activeQuote !== 'single') {
      if (activeQuote === 'double') activeQuote = null;
      else activeQuote = 'double';
      if (quote === null) quote = 'double';
      continue;
    }
    if (character === '\\' && activeQuote !== 'single' && index + 1 < raw.length) {
      const next = raw[++index];
      if (next === '\n') continue;
      if (activeQuote !== 'double' || '$`"\\'.includes(next)) text += next;
      else text += `\\${next}`;
      continue;
    }
    text += character;
  }
  return { text, quote, raw };
}

function substituteCommands(
  raw: string,
  source: string,
  nextId: { value: number },
  literalQuotes = false
): Token {
  let output = '';
  let single = false;
  let double = false;
  const substitutions: NonNullable<Token['cmdSubs']> = [];
  const processSubstitutions: NonNullable<Token['processSubs']> = [];
  for (let index = 0; index < raw.length; index++) {
    const character = raw[index];
    if (character === '\\' && !single) {
      output += raw.slice(index, index + 2);
      index++;
      continue;
    }
    if (!literalQuotes && !single && !double && character === '$' && raw[index + 1] === "'") {
      const ansi = readAnsiCQuote(raw, index);
      output += raw.slice(index, ansi.end);
      index = ansi.end - 1;
      continue;
    }
    if (!literalQuotes && character === "'" && !double) single = !single;
    if (!literalQuotes && character === '"' && !single) double = !double;
    if (
      !literalQuotes &&
      !single &&
      (character === '<' || character === '>') &&
      raw[index + 1] === '('
    ) {
      const end = readBalanced(raw, index + 1);
      let placeholder = '';
      do {
        placeholder = `__PROCESS_SUB_${nextId.value++}__`;
      } while (source.includes(placeholder));
      processSubstitutions.push({
        placeholder,
        command: raw.slice(index + 2, end - 1),
        direction: character === '<' ? 'input' : 'output',
      });
      output += placeholder;
      index = end - 1;
      continue;
    }
    if (!single && character === '$' && raw[index + 1] === '(' && raw[index + 2] === '(') {
      const end = readBalanced(raw, index + 1);
      const arithmetic = substituteCommands(raw.slice(index + 3, end - 2), source, nextId);
      output += `$((${arithmetic.raw ?? arithmetic.text}))`;
      substitutions.push(...(arithmetic.cmdSubs ?? []));
      index = end - 1;
      continue;
    }
    let end = index;
    let command = '';
    if (!single && character === '$' && raw[index + 1] === '(') {
      end = readBalanced(raw, index + 1);
      command = raw.slice(index + 2, end - 1);
    } else if (!single && character === '`') {
      end = index + 1;
      while (end < raw.length && raw[end] !== '`') {
        if (raw[end] === '\\') end++;
        end++;
      }
      if (end === raw.length) throw new ParseError('Unterminated command substitution', index);
      command = raw.slice(index + 1, end).replace(/\\([$`\\])/g, '$1');
      end++;
    }
    if (end > index) {
      let placeholder = '';
      do {
        placeholder = `__CMD_SUB_${nextId.value++}__`;
      } while (source.includes(placeholder));
      substitutions.push({ placeholder, command });
      output += placeholder;
      index = end - 1;
    } else output += character;
  }
  const token = makeShellToken(output);
  if (substitutions.length > 0) token.cmdSubs = substitutions;
  if (processSubstitutions.length > 0) {
    token.processSubs = processSubstitutions;
  }
  return token;
}

export function makeShellTextToken(source: string): Token {
  return substituteCommands(source, source, { value: 0 }, true);
}

/** Parse expansion input as words, with no command-position reserved words. */
export function parseShellWords(source: string): Token[] {
  const nextId = { value: 0 };
  return lexShell(source, false).map(lexeme => {
    if (lexeme.kind !== 'word') throw new ParseError('Expected shell word', lexeme.start);
    return substituteCommands(lexeme.source, source, nextId);
  });
}

export function parseCommandLine(line: string): Segment[] {
  const lexemes = lexShell(line);
  const segments: Segment[] = [];
  let current: Segment = { raw: '', tokens: [] };
  const nextId = { value: 0 };
  const makeToken = (source: string): Token => substituteCommands(source, line, nextId);
  const appendWord = (source: string) => current.tokens.push(makeToken(source));
  const hasCommand = () =>
    current.tokens.length > 0 ||
    current.compound !== undefined ||
    current.functionDefinition !== undefined;
  const finish = (separator?: Segment['separator']) => {
    if (!hasCommand() && current.inverted !== undefined)
      throw new ParseError('Expected command after !');
    if (!hasCommand() && current.redirections === undefined) return;
    current.separator = separator;
    current.raw = current.tokens.map(token => token.raw ?? token.text).join(' ');
    segments.push(current);
    current = { raw: '', tokens: [] };
  };
  const targetWord = (lexeme: Lexeme | undefined): string => {
    if (!lexeme || lexeme.kind !== 'word') throw new ParseError('Expected redirection target');
    return makeToken(lexeme.source).text;
  };
  for (let index = 0; index < lexemes.length; index++) {
    const lexeme = lexemes[index];
    if (lexeme.kind === 'word') {
      if (!hasCommand() && lexeme.source === '!') {
        if (segments.at(-1)?.separator === '|')
          throw new ParseError('Unexpected ! after pipe', lexeme.start);
        current.inverted = !current.inverted;
        continue;
      }
      const following = lexemes[index + 1];
      const descriptor =
        /^\d+$/.test(lexeme.source) &&
        following?.kind === 'operator' &&
        following.start === lexeme.end &&
        /^[<>]/.test(following.source);
      if (current.compound && !descriptor)
        throw new ParseError('Unexpected word after compound command', lexeme.start);
      appendWord(lexeme.source);
      continue;
    }
    if (lexeme.kind === 'compound') {
      if (hasCommand()) throw new ParseError('Unexpected compound command', lexeme.start);
      if (lexeme.functionName) {
        current.functionDefinition = { name: lexeme.functionName, source: lexeme.body };
        continue;
      }
      let kind: 'subshell' | 'group' = 'group';
      if (lexeme.subshell) kind = 'subshell';
      current.compound = lexeme.control ?? { kind, source: lexeme.body };
      continue;
    }
    const operator = lexeme.source;
    if (['|', '&&', '||', ';', '&', '\n'].includes(operator)) {
      const required = operator === '|' || operator === '&&' || operator === '||';
      if (required && !hasCommand()) throw new ParseError(`Unexpected ${operator}`, lexeme.start);
      if (operator === '\n') finish(';');
      else finish(operator as Segment['separator']);
      continue;
    }
    let fd = 1;
    if (operator.startsWith('<')) fd = 0;
    const previous = lexemes[index - 1];
    if (
      previous?.kind === 'word' &&
      previous.end === lexeme.start &&
      /^\d+$/.test(previous.source)
    ) {
      fd = Number(previous.source);
      current.tokens.pop();
    }
    const target = targetWord(lexemes[++index]);
    const targetLexeme = lexemes[index];
    let targetRaw = target;
    if (targetLexeme?.kind === 'word') targetRaw = targetLexeme.source;
    if (operator === '<<' || operator === '<<-') {
      const document = readHeredocDocument(line, lexeme.start);
      if (!document) throw new ParseError('Expected here-document delimiter', lexeme.start);
      current.stdinText = document.text;
      current.stdinExpand = document.expand;
      continue;
    }
    if (operator === '<') {
      if (fd !== 0) throw new ParseError('Input redirection requires descriptor 0', lexeme.start);
      current.redirections ??= [];
      current.redirections.push({ kind: 'input', fd: 0, path: target, raw: targetRaw });
      current.stdinText = undefined;
      continue;
    }
    if (operator === '>&' || operator === '<&') {
      current.redirections ??= [];
      if (target === '-') current.redirections.push({ kind: 'close', fd });
      else {
        if (!/^\d+$/.test(target)) throw new ParseError('Invalid file descriptor');
        const destination = Number(target);
        current.redirections.push({ kind: 'duplicate', fd, target: destination });
      }
      continue;
    }
    if (!['>', '>>', '&>', '&>>'].includes(operator)) {
      throw new ParseError(`Unsupported redirection ${operator}`, lexeme.start);
    }
    const append = operator.endsWith('>>');
    current.redirections ??= [];
    current.redirections.push({ kind: 'output', fd, path: target, raw: targetRaw, append });
    if (operator.startsWith('&')) {
      current.redirections.push({ kind: 'duplicate', fd: 2, target: 1 });
    }
  }
  if (
    !hasCommand() &&
    segments.at(-1)?.separator &&
    ['|', '&&', '||'].includes(segments.at(-1)?.separator ?? '')
  ) {
    throw new ParseError('Expected command after operator');
  }
  finish();
  return segments;
}

export default parseCommandLine;
