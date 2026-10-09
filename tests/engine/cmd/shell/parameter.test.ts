import { describe, expect, it } from 'vitest';
import { evaluateArithmetic } from '@/engine/cmd/shell/arithmetic';
import { expandParameters, expandParametersAsync } from '@/engine/cmd/shell/parameter';

describe('parameter expansion', () => {
  it('expands named variables, indexed script sources and unset variables', () => {
    const env = { HOME: '/home/user', USER: 'alice', 'BASH_SOURCE[0]': 'src/run-test.sh' };
    expect(expandParameters('$HOME ${USER} ${BASH_SOURCE[0]} $UNDEFINED', env)).toBe(
      '/home/user alice src/run-test.sh '
    );
  });

  it('distinguishes default and alternate values for unset and empty variables', () => {
    expect(
      expandParameters('${MISSING:-fallback}|${EMPTY-default}|${SET:+present}|${EMPTY+present}', {
        EMPTY: '',
        SET: 'value',
      })
    ).toBe('fallback||present|present');
  });

  it('assigns defaults and evaluates subsequent references in order', () => {
    const env: Record<string, string> = { EMPTY: '' };
    expect(expandParameters('${VALUE:=ready} ${#VALUE}', env)).toBe('ready 5');
    expect(env.VALUE).toBe('ready');
    expect(expandParameters('${EMPTY=unset-default}|${EMPTY:=empty-default}', env)).toBe(
      '|empty-default'
    );
    expect(env.EMPTY).toBe('empty-default');
  });

  it('handles nested defaults and braces inside quoted operands', () => {
    expect(expandParameters('${OUTER:-${INNER:-fallback}}', {})).toBe('fallback');
    expect(expandParameters('${OUTER:-"a}b${INNER:-c}"}', {})).toBe('a}bc');
    expect(expandParameters('${OUTER:-${INNER}}', { INNER: "literal 'quoted' \\ text" })).toBe(
      "literal 'quoted' \\ text"
    );
    expect(expandParameters("${MISSING:-$'a\\'b'}", {})).toBe("a'b");
  });

  it('expands indirect names and sorted prefix references', () => {
    expect(
      expandParameters('${!NAME} ${!APP_@}', {
        NAME: 'VALUE',
        VALUE: 'ready',
        APP_FIRST: 'a',
        APP_SECOND: 'b',
      })
    ).toBe('ready APP_FIRST APP_SECOND');
  });

  it('preserves printf escapes and suppresses expansion inside single quotes and escapes', () => {
    expect(expandParameters('"line1\\n$VALUE \\$VALUE"', { VALUE: 'expanded' })).toBe(
      '"line1\\nexpanded \\$VALUE"'
    );
    expect(expandParameters("'$VALUE'", { VALUE: 'expanded' })).toBe("'$VALUE'");
  });

  it('decodes ANSI-C escapes without expanding their contents', async () => {
    const options = {
      env: { VALUE: 'expanded' },
      nounset: false,
      substitutions: [{ placeholder: '__CMD_SUB_0__', command: 'forbidden' }],
      async substitute() {
        throw new Error('ANSI-C quote content must remain literal');
      },
    };
    await expect(expandParametersAsync("$'line\\n$VALUE\\x21'", options)).resolves.toBe(
      'line\n$VALUE!'
    );
    await expect(expandParametersAsync('"$\'literal\'"', options)).resolves.toBe('"$\'literal\'"');
    expect(expandParameters("$'A\\0B'|$'\\777'|$'\\c?'", {})).toBe(
      `A|${String.fromCharCode(255)}|${String.fromCharCode(127)}`
    );
    expect(() => expandParameters("$'\\U00110000'", {})).toThrow(
      'ANSI-C quote code point out of range'
    );
  });

  it('uses arithmetic substring offsets and negative endpoints', () => {
    const env = { STR: '0123456789', OFFSET: '2' };
    expect(expandParameters('${STR:OFFSET+1:3}|${STR: -3}|${STR:1:-2}', env)).toBe(
      '345|789|1234567'
    );
    expect(() => expandParameters('${STR:8:-3}', env)).toThrow('substring expression < 0');
  });

  it('applies shortest and longest removal and glob replacements', () => {
    const env = { PATH: '/usr/local/bin', FILE: 'document.txt.bak', STR: 'a1b22c' };
    expect(expandParameters('${PATH#*/}|${PATH##*/}|${FILE%.*}|${FILE%%.*}', env)).toBe(
      'usr/local/bin|bin|document.txt|document'
    );
    expect(expandParameters('${STR//[0-9]/}', env)).toBe('abc');
    expect(expandParameters('${FILE/#doc/DOC}|${FILE/%.bak/}', env)).toBe(
      'DOCument.txt.bak|document.txt'
    );
  });

  it('applies case transforms to matching characters', () => {
    expect(expandParameters('${STR^}|${STR^^}|${STR,,[A-Z]}', { STR: 'hello WORLD' })).toBe(
      'Hello WORLD|HELLO WORLD|hello world'
    );
  });

  it('derives array length, indices and slices from indexed entries', () => {
    const env = {
      'ARR[0]': 'file1.txt',
      'ARR[1]': 'file2.txt',
      'ARR[2]': 'file3.txt',
      'ARR[@]': 'stale snapshot',
    };
    expect(expandParameters('${#ARR[@]}|${!ARR[@]}|${ARR[@]:1:2}|${ARR[@]/.txt/.md}', env)).toBe(
      '3|0 1 2|file2.txt file3.txt|file1.md file2.md file3.md'
    );
    expect(expandParameters('${#MISSING[@]}', {})).toBe('0');
  });

  it('joins quoted star arrays with the first IFS character', () => {
    expect(expandParameters('${ARR[*]}', { 'ARR[0]': 'a', 'ARR[1]': 'b', IFS: ':' })).toBe('a:b');
    expect(expandParameters('${ARR[*]/a/A}', { 'ARR[0]': 'a', 'ARR[1]': 'b', IFS: ':' })).toBe(
      'A:b'
    );
  });

  it('uses sparse array indices for substring offsets', () => {
    expect(expandParameters('${ARR[@]:3}|${ARR[@]: -1}', { 'ARR[2]': 'a', 'ARR[5]': 'b' })).toBe(
      'b|b'
    );
  });

  it('reports nounset and required parameter errors', () => {
    expect(() => expandParameters('$MISSING', {}, true)).toThrow('MISSING: unbound variable');
    expect(() => expandParameters('${MISSING:?required}', {})).toThrow('MISSING: required');
    expect(expandParameters('${MISSING:-safe}', {}, true)).toBe('safe');
  });

  it('resolves selected command substitutions before default assignments', async () => {
    const env: Record<string, string> = { SET: 'ready', LITERAL: '__CMD_SUB_0__' };
    const calls: string[] = [];
    const options = {
      env,
      nounset: false,
      substitutions: [{ placeholder: '__CMD_SUB_0__', command: 'produce' }],
      async substitute(command: string) {
        calls.push(command);
        return "value 'quoted'";
      },
    };
    expect(await expandParametersAsync('${SET:-__CMD_SUB_0__}', options)).toBe('ready');
    expect(calls).toEqual([]);
    expect(await expandParametersAsync('${MISSING:=__CMD_SUB_0__} $MISSING', options)).toBe(
      "value 'quoted' value 'quoted'"
    );
    expect(env.MISSING).toBe("value 'quoted'");
    expect(env.LITERAL).toBe('__CMD_SUB_0__');
    expect(calls).toEqual(['produce']);
  });
});

describe('shell arithmetic', () => {
  it('uses integer division, recursive variable references and operator precedence', () => {
    expect(evaluateArithmetic('10 / 3 + 2 * 4', {})).toBe('11');
    expect(evaluateArithmetic('value + 1', { value: 'base * 2', base: '4' })).toBe('9');
    expect(evaluateArithmetic('2 ** 3 ** 2', {})).toBe('512');
  });

  it('updates variables through prefix, postfix and compound assignment', () => {
    const env = { COUNT: '3' };
    expect(evaluateArithmetic('COUNT++ + ++COUNT', env)).toBe('8');
    expect(env.COUNT).toBe('5');
    expect(evaluateArithmetic('COUNT <<= 2', env)).toBe('20');
    expect(env.COUNT).toBe('20');
  });

  it('supports comparisons, bit operators and lazy conditional branches', () => {
    const env: Record<string, string> = {};
    expect(evaluateArithmetic('3 < 4 && (8 >> 2) == 2', env)).toBe('1');
    expect(evaluateArithmetic('0 && (VALUE = 1)', env)).toBe('0');
    expect(evaluateArithmetic('1 ? 7 : 1 / 0', env)).toBe('7');
    expect(env.VALUE).toBeUndefined();
    expect(evaluateArithmetic('~0 & 15', env)).toBe('15');
  });

  it('supports base literals and signed integer overflow', () => {
    expect(evaluateArithmetic('010 + 16#ff + 0x10', {})).toBe('279');
    expect(evaluateArithmetic('9223372036854775807 + 1', {})).toBe('-9223372036854775808');
    expect(() => evaluateArithmetic('08', {})).toThrow('value too great for base');
  });

  it('reports invalid expressions and division by zero', () => {
    expect(() => evaluateArithmetic('1 / 0', {})).toThrow('division by 0');
    expect(() => evaluateArithmetic('value()', {})).toThrow('Invalid arithmetic expression');
    expect(() => evaluateArithmetic('VALUE', { VALUE: 'VALUE' })).toThrow(
      'recursive arithmetic variable'
    );
    expect(() => expandParameters('$((1 + 2)', {})).toThrow('Unterminated arithmetic expansion');
  });

  it('uses zero for empty arithmetic variables and honors nounset for missing ones', () => {
    expect(evaluateArithmetic('EMPTY + 1', { EMPTY: '' }, true)).toBe('1');
    expect(evaluateArithmetic('MISSING + 1', {})).toBe('1');
    expect(() => evaluateArithmetic('MISSING + 1', {}, true)).toThrow('MISSING: unbound variable');
  });
});
