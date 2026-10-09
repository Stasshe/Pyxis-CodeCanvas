import { UnixCommandBase } from './base';

type TrOptions = { delete: boolean; squeeze: boolean; complement: boolean; sets: string[] };

export class TrCommand extends UnixCommandBase {
  execute(args: string[], input: string): string {
    const options = parseOptions(args);
    let minimumSets = 2;
    if (options.delete && options.squeeze) minimumSets = 2;
    else if (options.delete || options.squeeze) minimumSets = 1;
    if (options.sets.length < minimumSets) {
      throw new Error('tr: missing operand\nUsage: tr [OPTION]... SET1 [SET2]');
    }
    if (options.sets.length > 2) throw new Error('tr: extra operand');
    if (options.delete && !options.squeeze && options.sets.length > 1) {
      throw new Error('tr: extra operand');
    }
    const firstSet = expandSet(options.sets[0]);
    const secondSet = options.sets[1] === undefined ? [] : expandSet(options.sets[1]);
    if (!options.delete && !options.squeeze && secondSet.length === 0) {
      throw new Error('tr: SET2 must be non-empty');
    }
    const members = new Set(firstSet);
    const mapping = new Map<string, string>();
    if (!options.delete) {
      for (const character of new Set(input)) {
        if (options.complement && members.has(character)) continue;
        let index = firstSet.indexOf(character);
        if (options.complement) index = complementIndex(character, firstSet);
        if (!mapping.has(character))
          mapping.set(character, secondSet[Math.min(index, secondSet.length - 1)]);
      }
    }

    let output = '';
    let previous = '';
    let squeezeSet: Set<string> | null = null;
    let squeezeComplement = false;
    if (options.squeeze) {
      if (options.delete && secondSet.length === 0) squeezeSet = members;
      else if (secondSet.length > 0) squeezeSet = new Set(secondSet);
      else {
        squeezeSet = members;
        squeezeComplement = options.complement;
      }
    }
    for (const character of input) {
      if (options.delete && selected(character, members, options.complement)) continue;
      const translated = mapping.get(character) ?? character;
      if (
        squeezeSet &&
        selected(translated, squeezeSet, squeezeComplement) &&
        translated === previous
      )
        continue;
      output += translated;
      previous = translated;
    }
    return output;
  }
}

function parseOptions(args: string[]): TrOptions {
  let deleteCharacters = false;
  let squeeze = false;
  let complement = false;
  let optionsEnded = false;
  const sets: string[] = [];
  for (const argument of args) {
    if (optionsEnded) {
      sets.push(argument);
      continue;
    }
    if (argument === '--') {
      optionsEnded = true;
      continue;
    }
    if (argument.startsWith('--')) {
      if (argument === '--delete') deleteCharacters = true;
      else if (argument === '--squeeze-repeats') squeeze = true;
      else if (argument === '--complement') complement = true;
      else throw new Error(`tr: unrecognized option '${argument}'`);
      continue;
    }
    if (argument.startsWith('-') && argument.length > 1) {
      for (const option of argument.slice(1)) {
        if (option === 'd') deleteCharacters = true;
        else if (option === 's') squeeze = true;
        else if (option === 'c' || option === 'C') complement = true;
        else throw new Error(`tr: invalid option -- '${option}'`);
      }
      continue;
    }
    optionsEnded = true;
    sets.push(argument);
  }
  return { delete: deleteCharacters, squeeze, complement, sets };
}

function selected(character: string, set: Set<string>, complement: boolean): boolean {
  if (complement) return !set.has(character);
  return set.has(character);
}

function complementIndex(character: string, set: string[]): number {
  const code = character.codePointAt(0) ?? 0;
  const excluded = new Set(set);
  let count = 0;
  for (const member of excluded) {
    if ((member.codePointAt(0) ?? 0) < code) count += 1;
  }
  return Math.max(0, code - count);
}

function expandSet(value: string): string[] {
  const characters: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const classEnd = value.indexOf(':]', index);
    if (value[index] === '[' && value[index + 1] === ':' && classEnd >= 0) {
      characters.push(...expandClass(value.slice(index + 2, classEnd)));
      index = classEnd + 1;
      continue;
    }
    if (value[index] === '\\') {
      const escaped = expandEscape(value, index);
      if (escaped) {
        characters.push(escaped.character);
        index = escaped.end;
        continue;
      }
    }
    const start = value.codePointAt(index);
    const end = value.codePointAt(index + 2);
    if (value[index + 1] === '-' && start !== undefined && end !== undefined && start <= end) {
      for (let code = start; code <= end; code += 1) characters.push(String.fromCodePoint(code));
      index += 2;
      continue;
    }
    characters.push(String.fromCodePoint(start ?? 0));
    if ((start ?? 0) > 0xffff) index += 1;
  }
  return characters;
}

function expandEscape(value: string, index: number): { character: string; end: number } | null {
  const next = value[index + 1];
  const simple: Record<string, string> = {
    a: '\x07',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v',
    '\\': '\\',
  };
  if (simple[next] !== undefined) return { character: simple[next], end: index + 1 };
  if (next >= '0' && next <= '7') {
    const digits = value.slice(index + 1, index + 4).match(/^[0-7]{1,3}/)?.[0] ?? '';
    return {
      character: String.fromCodePoint(Number.parseInt(digits, 8)),
      end: index + digits.length,
    };
  }
  return null;
}

function expandClass(name: string): string[] {
  if (name === 'lower') return range(97, 122);
  if (name === 'upper') return range(65, 90);
  if (name === 'digit') return range(48, 57);
  if (name === 'xdigit') return [...'0123456789abcdefABCDEF'];
  if (name === 'space') return [' ', '\t', '\n', '\v', '\f', '\r'];
  if (name === 'blank') return [' ', '\t'];
  if (name === 'alpha' || name === 'alnum') {
    const letters = [...range(97, 122), ...range(65, 90)];
    return name === 'alpha' ? letters : [...letters, ...range(48, 57)];
  }
  if (name === 'cntrl') return range(0, 31);
  if (name === 'print') return range(32, 126);
  if (name === 'graph') return range(33, 126);
  if (name === 'punct') return [...'!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~'];
  throw new Error(`tr: invalid character class '${name}'`);
}

function range(first: number, last: number): string[] {
  const characters: string[] = [];
  for (let code = first; code <= last; code += 1) characters.push(String.fromCharCode(code));
  return characters;
}
