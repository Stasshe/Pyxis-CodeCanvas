import { fnmatch } from '../../core/fs/fnmatch';
import { evaluateArithmetic } from './arithmetic';
import { ParseError } from './errors';

export type ExpansionRenderer = (values: string[], quoted: boolean, multiple: boolean) => string;

interface Parameter {
  name: string;
  values: string[];
  set: boolean;
  multiple: boolean;
  indices: number[];
}

interface ExpandedParameter {
  values: string[];
  multiple: boolean;
}

interface ParameterWord {
  source: string;
  pattern: boolean;
}

function identity(values: string[]): string {
  return values.join(' ');
}

export function parameterEnd(source: string, start: number): number {
  let depth = 1;
  let quote = '';
  const quotes: string[] = [];
  for (let index = start + 2; index < source.length; index++) {
    const character = source[index];
    if (quote === '' && source.startsWith("$'", index)) {
      index = readAnsiCQuote(source, index).end - 1;
      continue;
    }
    if (character === '\\' && quote !== "'") {
      index++;
      continue;
    }
    if (character === quote) {
      quote = '';
      continue;
    }
    if ((character === '"' || character === "'") && quote === '') {
      quote = character;
      continue;
    }
    if (quote === "'") continue;
    if (character === '$' && source[index + 1] === '{') {
      quotes.push(quote);
      quote = '';
      depth++;
      index++;
    } else if (character === '}' && quote === '') {
      depth--;
      if (depth === 0) return index;
      quote = quotes.pop() ?? '';
    }
  }
  throw new Error('Unterminated parameter expansion');
}

export function arithmeticEnd(source: string, start: number): number {
  let depth = 0;
  for (let index = start + 3; index < source.length; index++) {
    if (source[index] === '(') depth++;
    if (source[index] !== ')') continue;
    if (depth > 0) depth--;
    else if (source[index + 1] === ')') return index;
  }
  throw new Error('Unterminated arithmetic expansion');
}

export function readAnsiCQuote(source: string, start: number): { end: number; value: string } {
  let value = '';
  let nulTerminated = false;
  const append = (character: string) => {
    if (character === '\0') {
      nulTerminated = true;
      return;
    }
    if (!nulTerminated) value += character;
  };
  for (let index = start + 2; index < source.length; index++) {
    const character = source[index];
    if (character === "'") return { end: index + 1, value };
    if (character !== '\\') {
      append(character);
      continue;
    }
    const escaped = source[++index];
    if (escaped === undefined) break;
    const controls: Record<string, string> = {
      a: String.fromCharCode(7),
      b: String.fromCharCode(8),
      e: String.fromCharCode(27),
      E: String.fromCharCode(27),
      f: String.fromCharCode(12),
      n: '\n',
      r: '\r',
      t: '\t',
      v: String.fromCharCode(11),
      '\\': '\\',
      "'": "'",
      '"': '"',
      '?': '?',
    };
    if (escaped === 'c' && index + 1 < source.length) {
      const control = source[++index];
      if (control === '?') append(String.fromCharCode(127));
      else append(String.fromCharCode(control.charCodeAt(0) & 31));
      continue;
    }
    if (escaped === 'x' || escaped === 'u' || escaped === 'U') {
      const digits = escaped === 'x' ? 2 : escaped === 'u' ? 4 : 8;
      const match = source.slice(index + 1).match(new RegExp(`^[0-9a-fA-F]{1,${digits}}`));
      if (match) {
        const codePoint = Number.parseInt(match[0], 16);
        if (codePoint > 0x10ffff) throw new Error('ANSI-C quote code point out of range');
        append(String.fromCodePoint(codePoint));
        index += match[0].length;
        continue;
      }
    }
    if (/[0-7]/.test(escaped)) {
      const match = source.slice(index).match(/^[0-7]{1,3}/);
      if (match) {
        append(String.fromCharCode(Number.parseInt(match[0], 8) & 0xff));
        index += match[0].length - 1;
        continue;
      }
    }
    if (controls[escaped] !== undefined) append(controls[escaped]);
    else append(`\\${escaped}`);
  }
  throw new ParseError('Unterminated ANSI-C quote', start);
}

function readParameter(
  name: string,
  index: string | undefined,
  env: Record<string, string>,
  nounset = false
): Parameter {
  const indices: number[] = [];
  for (const key of Object.keys(env)) {
    const match = key.match(/^([A-Za-z_][A-Za-z0-9_]*)\[(\d+)\]$/);
    if (match && match[1] === name) indices.push(Number(match[2]));
  }
  indices.sort((left, right) => left - right);
  if ((name === '@' || name === '*') && env['#'] !== undefined) {
    const values: string[] = [];
    for (let argument = 1; argument <= Number(env['#']); argument++)
      values.push(env[String(argument)] ?? '');
    return { name, values, set: true, multiple: name === '@', indices };
  }
  if (index === '@' || index === '*') {
    let values = indices.map(key => env[`${name}[${key}]`]);
    if (values.length === 0 && env[name] !== undefined) values = [env[name]];
    return { name, values, set: values.length > 0, multiple: index === '@', indices };
  }
  let key = name;
  if (index !== undefined) {
    let offset = Number(evaluateArithmetic(index, env, nounset));
    if (offset < 0 && indices.length > 0) offset += indices[indices.length - 1] + 1;
    key = `${name}[${offset}]`;
    if (offset === 0 && env[key] === undefined && env[name] !== undefined) key = name;
  } else if (env[`${name}[0]`] !== undefined) {
    key = `${name}[0]`;
  }
  const value = env[key];
  if (value === undefined) return { name: key, values: [''], set: false, multiple: false, indices };
  return { name: key, values: [value], set: true, multiple: false, indices };
}

function unquote(
  source: string,
  pattern = false,
  replacements = new Map<string, string>()
): string {
  let result = '';
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const replacement = [...replacements.keys()].find(key => source.startsWith(key, index));
    if (replacement) {
      let value = replacements.get(replacement) ?? '';
      if (pattern && quote) value = value.replace(/[\\*?[]/g, '\\$&');
      result += value;
      index += replacement.length - 1;
      continue;
    }
    const character = source[index];
    if (character === quote) {
      quote = '';
      continue;
    }
    if (quote === '' && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (character === '\\' && quote !== "'" && index + 1 < source.length) {
      if (pattern) result += '\\';
      result += source[++index];
      continue;
    }
    if (pattern && quote && '*?['.includes(character)) result += '\\';
    result += character;
  }
  return result;
}

function removePattern(value: string, pattern: string, prefix: boolean, longest: boolean): string {
  for (let step = 0; step <= value.length; step++) {
    let length = step;
    if (longest) length = value.length - step;
    let candidate = value.slice(value.length - length);
    if (prefix) candidate = value.slice(0, length);
    if (fnmatch(pattern, candidate, 0) !== 0) continue;
    if (prefix) return value.slice(length);
    return value.slice(0, value.length - length);
  }
  return value;
}

function replacementSeparator(source: string): number {
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === quote) {
      quote = '';
      continue;
    }
    if (quote === '' && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (character === '/' && quote === '') return index;
  }
  return -1;
}

function replacePattern(value: string, pattern: string, replacement: string, mode: string): string {
  let result = '';
  let start = 0;
  while (start <= value.length) {
    if (mode === '#' && start !== 0) break;
    let end = value.length;
    while (end >= start) {
      if (mode === '%' && end !== value.length) break;
      if (fnmatch(pattern, value.slice(start, end), 0) === 0) break;
      end--;
    }
    if (end < start || (mode === '%' && fnmatch(pattern, value.slice(start), 0) !== 0)) {
      result += value[start] ?? '';
      start++;
      continue;
    }
    result += replacement;
    if (mode !== '/') return result + value.slice(end);
    if (end === start) {
      result += value[start] ?? '';
      start++;
    } else start = end;
  }
  return result + value.slice(start);
}

function substring(
  values: string[],
  expression: string,
  array: boolean,
  env: Record<string, string>,
  indices: number[],
  nounset: boolean
): string[] {
  const separator = expression.indexOf(':');
  let offsetSource = expression;
  let lengthSource: string | undefined;
  if (separator !== -1) {
    offsetSource = expression.slice(0, separator);
    lengthSource = expression.slice(separator + 1);
  }
  let size = Array.from(values[0] ?? '').length;
  if (array) {
    size = values.length;
    if (indices.length > 0) size = indices[indices.length - 1] + 1;
  }
  let offset = Number(evaluateArithmetic(offsetSource, env, nounset));
  if (offset < 0) offset += size;
  if (offset < 0) {
    if (array) return [];
    return [''];
  }
  if (array && indices.length > 0) {
    offset = indices.findIndex(index => index >= offset);
    if (offset === -1) return [];
    size = values.length;
  }
  let end = size;
  if (lengthSource !== undefined) {
    const length = Number(evaluateArithmetic(lengthSource, env, nounset));
    if (length < 0) {
      if (array) throw new Error('substring expression < 0');
      end = size + length;
      if (end < offset) throw new Error('substring expression < 0');
    } else end = offset + length;
  }
  if (array) return values.slice(offset, end);
  return [
    Array.from(values[0] ?? '')
      .slice(offset, end)
      .join(''),
  ];
}

function* evaluateParameter(
  expression: string,
  env: Record<string, string>,
  nounset: boolean
): Generator<ParameterWord, ExpandedParameter, string> {
  const prefix = expression.match(/^!([A-Za-z_][A-Za-z0-9_]*)[@*]$/);
  if (prefix)
    return {
      values: Object.keys(env)
        .filter(name => name.startsWith(prefix[1]) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name))
        .sort(),
      multiple: expression.endsWith('@'),
    };
  const match = expression.match(
    /^([#!]?)([A-Za-z_][A-Za-z0-9_]*|[0-9]+|[?@*#$!_-])(?:\[([^\]]+)\])?([\s\S]*)$/
  );
  if (!match) throw new Error('Invalid parameter expansion');
  const [, modifier, name, index, operation] = match;
  let parameter = readParameter(name, index, env, nounset);
  if (modifier === '!') {
    if (index === '@' || index === '*')
      return { values: parameter.indices.map(String), multiple: index === '@' };
    parameter = readParameter(parameter.values[0], undefined, env, nounset);
  }
  if (modifier === '#') {
    if (!parameter.set && nounset) throw new Error(`${name}: unbound variable`);
    let length: number;
    if (index === '@' || index === '*' || name === '@' || name === '*')
      length = parameter.values.length;
    else length = Array.from(parameter.values[0] ?? '').length;
    return { values: [String(length)], multiple: false };
  }
  const alternative = operation.match(/^(:?[-+=?])([\s\S]*)$/);
  if (alternative) {
    const [, operator, word] = alternative;
    const missing =
      !parameter.set || (operator.startsWith(':') && parameter.values.every(value => value === ''));
    const action = operator.slice(-1);
    if (action === '+') {
      if (missing) return { values: [''], multiple: false };
      const value = yield { source: word, pattern: false };
      return { values: [value], multiple: false };
    }
    if (missing) {
      const value = yield { source: word, pattern: false };
      if (action === '?') throw new Error(`${name}: ${value || 'parameter null or not set'}`);
      if (action === '=') {
        if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\[\d+\])?$/.test(parameter.name))
          throw new Error('Cannot assign a special parameter');
        env[parameter.name] = value;
      }
      return { values: [value], multiple: false };
    }
    return parameter;
  }
  if (!parameter.set && nounset) throw new Error(`${name}: unbound variable`);
  if (!operation) {
    if (index === '*' || name === '*')
      return { values: [parameter.values.join((env.IFS ?? ' ')[0] ?? '')], multiple: false };
    return parameter;
  }
  if (operation.startsWith(':')) {
    const expression = yield { source: operation.slice(1), pattern: false };
    return {
      values: substring(
        parameter.values,
        expression,
        index === '@' || index === '*',
        env,
        parameter.indices,
        nounset
      ),
      multiple: parameter.multiple,
    };
  }
  if (operation.startsWith('#') || operation.startsWith('%')) {
    const prefixRemoval = operation[0] === '#';
    const longest = operation[1] === operation[0];
    let start = 1;
    if (longest) start = 2;
    const pattern = yield { source: operation.slice(start), pattern: true };
    return {
      values: parameter.values.map(value => removePattern(value, pattern, prefixRemoval, longest)),
      multiple: parameter.multiple,
    };
  }
  if (operation.startsWith('/')) {
    let start = 1;
    let mode = '';
    if ('/#%'.includes(operation[1] ?? '') && operation.length > 1) {
      mode = operation[1];
      start++;
    }
    const body = operation.slice(start);
    const separator = replacementSeparator(body);
    let pattern = body;
    let replacement = '';
    if (separator !== -1) {
      pattern = body.slice(0, separator);
      replacement = yield { source: body.slice(separator + 1), pattern: false };
    }
    pattern = yield { source: pattern, pattern: true };
    return {
      values: parameter.values.map(value => replacePattern(value, pattern, replacement, mode)),
      multiple: parameter.multiple,
    };
  }
  if (operation.startsWith('^') || operation.startsWith(',')) {
    const upper = operation[0] === '^';
    const all = operation[1] === operation[0];
    let start = 1;
    if (all) start = 2;
    const pattern = (yield { source: operation.slice(start), pattern: true }) || '?';
    const values = parameter.values.map(value =>
      Array.from(value)
        .map((character, position) => {
          if ((!all && position > 0) || fnmatch(pattern, character, 0) !== 0) return character;
          if (upper) return character.toUpperCase();
          return character.toLowerCase();
        })
        .join('')
    );
    return { values, multiple: parameter.multiple };
  }
  throw new Error('Invalid parameter expansion');
}

function expandParameter(
  expression: string,
  env: Record<string, string>,
  nounset: boolean
): ExpandedParameter {
  const evaluation = evaluateParameter(expression, env, nounset);
  let step = evaluation.next();
  while (!step.done) {
    const word = step.value;
    const fragments = wordFragments(word.source);
    const expanded = expandParameters(word.source, env, nounset, fragments.render);
    step = evaluation.next(unquote(expanded, word.pattern, fragments.values));
  }
  return joinStar(step.value, env);
}

function joinStar(expanded: ExpandedParameter, env: Record<string, string>): ExpandedParameter {
  if (!expanded.multiple && expanded.values.length > 1) {
    return { values: [expanded.values.join((env.IFS ?? ' ')[0] ?? '')], multiple: false };
  }
  return expanded;
}

function wordFragments(source: string): { values: Map<string, string>; render: ExpansionRenderer } {
  const values = new Map<string, string>();
  let prefix = '__PARAMETER_WORD_';
  while (source.includes(prefix)) prefix += '_';
  return {
    values,
    render(items) {
      const key = `${prefix}${values.size}__`;
      values.set(key, items.join(' '));
      return key;
    },
  };
}

export interface AsyncExpansionOptions {
  env: Record<string, string>;
  nounset: boolean;
  substitutions: Array<{ placeholder: string; command: string }>;
  substitute(command: string): Promise<string>;
  render?: ExpansionRenderer;
  literalQuotes?: boolean;
}

async function expandParameterAsync(
  expression: string,
  options: AsyncExpansionOptions
): Promise<ExpandedParameter> {
  const evaluation = evaluateParameter(expression, options.env, options.nounset);
  let step = evaluation.next();
  while (!step.done) {
    const word = step.value;
    const fragments = wordFragments(word.source);
    const expanded = await expandParametersAsync(word.source, {
      ...options,
      render: fragments.render,
      literalQuotes: false,
    });
    step = evaluation.next(unquote(expanded, word.pattern, fragments.values));
  }
  return joinStar(step.value, options.env);
}

export async function expandParametersAsync(
  source: string,
  options: AsyncExpansionOptions
): Promise<string> {
  const render = options.render ?? identity;
  let result = '';
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (!options.literalQuotes && quote === '' && source.startsWith("$'", index)) {
      const quote = readAnsiCQuote(source, index);
      result += render([quote.value], true, false);
      index = quote.end - 1;
      continue;
    }
    if (character === '\\' && quote !== "'" && index + 1 < source.length) {
      result += character + source[++index];
      continue;
    }
    if (!options.literalQuotes && character === quote) {
      quote = '';
      result += character;
      continue;
    }
    if (!options.literalQuotes && quote === '' && (character === "'" || character === '"')) {
      quote = character;
      result += character;
      continue;
    }
    if (quote !== "'") {
      const substitution = options.substitutions.find(item =>
        source.startsWith(item.placeholder, index)
      );
      if (substitution) {
        result += render([await options.substitute(substitution.command)], quote === '"', false);
        index += substitution.placeholder.length - 1;
        continue;
      }
    }
    if (character !== '$' || quote === "'") {
      result += character;
      continue;
    }
    if (source.startsWith('$((', index)) {
      const end = arithmeticEnd(source, index);
      const expression = await expandParametersAsync(source.slice(index + 3, end), {
        ...options,
        render: identity,
      });
      result += render(
        [evaluateArithmetic(unquote(expression), options.env, options.nounset)],
        quote === '"',
        false
      );
      index = end + 1;
      continue;
    }
    if (source[index + 1] === '{') {
      const end = parameterEnd(source, index);
      const expanded = await expandParameterAsync(source.slice(index + 2, end), options);
      result += render(expanded.values, quote === '"', expanded.multiple);
      index = end;
      continue;
    }
    const match = source.slice(index + 1).match(/^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9?@*#$!_-])/);
    if (!match) {
      result += '$';
      continue;
    }
    result += expandParameters(
      `$${match[0]}`,
      options.env,
      options.nounset,
      (values, _quoted, multiple) => render(values, quote === '"', multiple)
    );
    index += match[0].length;
  }
  return result;
}

export function expandParameters(
  source: string,
  env: Record<string, string>,
  nounset = false,
  render: ExpansionRenderer = identity
): string {
  let result = '';
  let quote = '';
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quote === '' && source.startsWith("$'", index)) {
      const quote = readAnsiCQuote(source, index);
      result += render([quote.value], true, false);
      index = quote.end - 1;
      continue;
    }
    if (character === '\\' && quote !== "'" && index + 1 < source.length) {
      result += character + source[++index];
      continue;
    }
    if (character === quote) {
      quote = '';
      result += character;
      continue;
    }
    if (quote === '' && (character === "'" || character === '"')) {
      quote = character;
      result += character;
      continue;
    }
    if (character !== '$' || quote === "'") {
      result += character;
      continue;
    }
    if (source.startsWith('$((', index)) {
      const end = arithmeticEnd(source, index);
      const expression = unquote(expandParameters(source.slice(index + 3, end), env, nounset));
      result += render([evaluateArithmetic(expression, env, nounset)], quote === '"', false);
      index = end + 1;
      continue;
    }
    if (source[index + 1] === '{') {
      const end = parameterEnd(source, index);
      const expanded = expandParameter(source.slice(index + 2, end), env, nounset);
      result += render(expanded.values, quote === '"', expanded.multiple);
      index = end;
      continue;
    }
    const match = source.slice(index + 1).match(/^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9?@*#$!_-])/);
    if (!match) {
      result += '$';
      continue;
    }
    const name = match[0];
    let value = env[name];
    if (env[`${name}[0]`] !== undefined) value = env[`${name}[0]`];
    if (value === undefined && nounset && !'@*'.includes(name))
      throw new Error(`${name}: unbound variable`);
    if (name === '@' && env['#'] !== undefined) {
      const values: string[] = [];
      for (let argument = 1; argument <= Number(env['#']); argument++)
        values.push(env[String(argument)] ?? '');
      result += render(values, quote === '"', true);
    } else if (name === '*' && env['#'] !== undefined) {
      const values: string[] = [];
      for (let argument = 1; argument <= Number(env['#']); argument++)
        values.push(env[String(argument)] ?? '');
      result += render([values.join((env.IFS ?? ' ')[0] ?? '')], quote === '"', false);
    } else result += render([value ?? ''], quote === '"', false);
    index += name.length;
  }
  return result;
}
