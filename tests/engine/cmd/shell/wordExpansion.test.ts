import { describe, expect, it } from 'vitest';
import { parseCommandLine } from '@/engine/cmd/shell/parser';
import {
  expandCommandSegment,
  expandShellText,
  expandShellWords,
} from '@/engine/cmd/shell/wordExpansion';
import { setupTestProject } from '../../../_helpers/testProject';

async function fixture(env: Record<string, string> = {}) {
  const { repo, rootPath } = await setupTestProject('WordExpansionTest');
  return { rootPath, cwd: rootPath, fsClient: repo, env, nounset: false };
}

const shell = {
  async runInSubshell() {
    return { stdout: '', stderr: '', code: 0 };
  },
  async processSubstitution(): Promise<string> {
    throw new Error('Unexpected process substitution');
  },
};

describe('word expansion', () => {
  it('expands data containing operators and quotes without interpreting it as syntax', async () => {
    const options = await fixture({ CONTENT: "one; two | three 'quoted'" });
    expect(await expandShellWords('"$CONTENT"', options, shell)).toEqual([
      "one; two | three 'quoted'",
    ]);
    expect(await expandShellWords('$CONTENT', options, shell)).toEqual([
      'one;',
      'two',
      '|',
      'three',
      "'quoted'",
    ]);
  });

  it('splits only unquoted expansion fragments and preserves literal escapes', async () => {
    const options = await fixture({ VALUE: ' a b ', IFS: ' ' });
    expect(
      await expandShellWords('pre${VALUE}post "pre${VALUE}post" one\\ two', options, shell)
    ).toEqual(['pre', 'a', 'b', 'post', 'pre a b post', 'one two']);
    expect(await expandShellWords('"" $MISSING "$MISSING"', options, shell)).toEqual(['', '']);
  });

  it('applies mixed, empty, and nonwhitespace IFS through word expansion', async () => {
    const options = await fixture({ VALUE: 'alpha\tbeta\ngamma' });
    expect(await expandShellWords('$VALUE', options, shell)).toEqual(['alpha', 'beta', 'gamma']);

    options.env.IFS = ' :';
    options.env.VALUE = 'alpha : beta::gamma: ';
    expect(await expandShellWords('$VALUE', options, shell)).toEqual([
      'alpha',
      'beta',
      '',
      'gamma',
    ]);

    options.env.IFS = '';
    options.env.VALUE = 'alpha beta';
    expect(await expandShellWords('$VALUE', options, shell)).toEqual(['alpha beta']);

    options.env.IFS = ',';
    options.env.VALUE = ',alpha';
    expect(await expandShellWords('$VALUE', options, shell)).toEqual(['', 'alpha']);
  });

  it('preserves printf escapes, assignment quoting and expanded script source', async () => {
    const options = await fixture({ VALUE: 'expanded', 'BASH_SOURCE[0]': 'src/run-test.sh' });
    expect(await expandShellWords('"line1\\n$VALUE \\$VALUE"', options, shell)).toEqual([
      'line1\\nexpanded $VALUE',
    ]);
    expect(await expandShellWords("VALUE='value with spaces'", options, shell)).toEqual([
      'VALUE=value with spaces',
    ]);
    expect(await expandShellWords('"${BASH_SOURCE[0]}"', options, shell)).toEqual([
      'src/run-test.sh',
    ]);
  });

  it('decodes ANSI-C quotes as protected literal text', async () => {
    const options = await fixture({ VALUE: 'expanded' });
    expect(await expandShellWords("$'one\\ntwo $VALUE *'", options, shell)).toEqual([
      'one\ntwo $VALUE *',
    ]);
  });

  it('preserves exact quoted positional and array element boundaries', async () => {
    const options = await fixture({
      'ARR[0]': 'a b',
      'ARR[1]': '',
      'ARR[2]': '*',
      '1': 'x y',
      '2': '',
      '#': '2',
    });
    expect(await expandShellWords('pre"${ARR[@]}"post "$@"', options, shell)).toEqual([
      'prea b',
      '',
      '*post',
      'x y',
      '',
    ]);
    expect(await expandShellWords('"${MISSING[@]}"', options, shell)).toEqual([]);
    options.env['#'] = '0';
    expect(await expandShellWords('"$@"', options, shell)).toEqual([]);
  });

  it('keeps unquoted positional and indexed array elements separate before IFS splitting', async () => {
    const options = await fixture({
      IFS: '',
      '1': 'first value',
      '2': 'second',
      '#': '2',
      'ITEMS[0]': 'third value',
      'ITEMS[1]': 'fourth',
    });
    expect(await expandShellWords('$@', options, shell)).toEqual(['first value', 'second']);
    expect(await expandShellWords('${ITEMS[@]}', options, shell)).toEqual([
      'third value',
      'fourth',
    ]);

    options.env.IFS = ',';
    options.env['1'] = 'first,part';
    options.env['2'] = 'second';
    expect(await expandShellWords('pre$@post', options, shell)).toEqual([
      'prefirst',
      'part',
      'secondpost',
    ]);

    options.env['1'] = 'a';
    options.env['2'] = ',b';
    expect(await expandShellWords('$@', options, shell)).toEqual(['a', '', 'b']);
    options.env['1'] = 'a,';
    expect(await expandShellWords('$@', options, shell)).toEqual(['a', '', '', 'b']);

    options.env['1'] = 'a';
    options.env['2'] = ',b';
    options.env.IFS = ' ,';
    expect(await expandShellWords('$@', options, shell)).toEqual(['a', 'b']);
    options.env.IFS = ', ';
    expect(await expandShellWords('$@', options, shell)).toEqual(['a', '', 'b']);
  });

  it('protects quoted wildcard fragments and expands braces before variable data', async () => {
    const options = await fixture({ VALUE: '{a,b}' });
    await options.fsClient.writeFile(`${options.rootPath}/literal*one.txt`, 'one');
    await options.fsClient.writeFile(`${options.rootPath}/literalXtwo.txt`, 'two');
    expect(await expandShellWords('literal"*"*.txt', options, shell)).toEqual(['literal*one.txt']);
    expect(await expandShellWords('$VALUE {a,b} "{a,b}"', options, shell)).toEqual([
      '{a,b}',
      'a',
      'b',
      '{a,b}',
    ]);
  });

  it('preserves carriage returns while stripping trailing command output newlines', async () => {
    const options = await fixture();
    const producer = {
      ...shell,
      async runInSubshell() {
        return { stdout: 'first\r\nsecond\r\n\n', stderr: '', code: 0 };
      },
    };
    expect(await expandShellWords('"$(produce)"', options, producer)).toEqual([
      'first\r\nsecond\r',
    ]);
  });

  it('expands heredoc text with literal quotes and heredoc escape rules', async () => {
    const options = await fixture({ VALUE: 'expanded' });
    expect(await expandShellText('\'$VALUE\' "$VALUE" \\$VALUE \\n \\"\n', options, shell)).toBe(
      '\'expanded\' "expanded" $VALUE \\n \\"\n'
    );
  });

  it('preserves quotes inside heredoc command substitutions', async () => {
    const options = await fixture();
    const commands: string[] = [];
    const producer = {
      ...shell,
      async runInSubshell(command: string) {
        commands.push(command);
        return { stdout: 'hello\n', stderr: '', code: 0 };
      },
    };
    expect(await expandShellText('\'$(echo "hello")\'\n', options, producer)).toBe("'hello'\n");
    expect(commands).toEqual(['echo "hello"']);
  });

  it('preserves declaration assignment values while splitting other operands normally', async () => {
    const options = await fixture({
      WORDS: 'first second',
      GLOB: '*.txt',
      ASSIGNMENT: 'NAME=first second',
    });
    const context = {
      ...options,
      async getWorkingDirectory() {
        return options.cwd;
      },
    };
    const producer = {
      ...shell,
      async runInSubshell() {
        return { stdout: ' first second *\n', stderr: '', code: 0 };
      },
    };
    const declaration = parseCommandLine(
      'export NAME=$(produce) WORDS=$WORDS PATTERN=$GLOB EMPTY=$MISSING'
    )[0];
    expect((await expandCommandSegment(declaration, context, producer)).words).toEqual([
      'export',
      'NAME= first second *',
      'WORDS=first second',
      'PATTERN=*.txt',
      'EMPTY=',
    ]);
    const expandedOperand = parseCommandLine('export $ASSIGNMENT')[0];
    expect((await expandCommandSegment(expandedOperand, context, producer)).words).toEqual([
      'export',
      'NAME=first',
      'second',
    ]);
    const ordinary = parseCommandLine('echo NAME=$WORDS')[0];
    expect((await expandCommandSegment(ordinary, context, producer)).words).toEqual([
      'echo',
      'NAME=first',
      'second',
    ]);
  });

  it('applies standalone assignments in order before expanding following values', async () => {
    const options = await fixture({ A: 'old' });
    const context = {
      ...options,
      async getWorkingDirectory() {
        return options.cwd;
      },
    };
    const producer = {
      ...shell,
      async runInSubshell() {
        return { stdout: `${options.env.B}\n`, stderr: '', code: 0 };
      },
    };
    const segment = parseCommandLine(
      'A="first second" B=$A C=$(produce) PATTERN=*.txt BRACES={one,two} EMPTY='
    )[0];
    const expanded = await expandCommandSegment(segment, context, producer);
    expect(expanded.assignmentOnly).toBe(true);
    expect(options.env).toEqual({
      A: 'first second',
      B: 'first second',
      C: 'first second',
      PATTERN: '*.txt',
      BRACES: '{one,two}',
      EMPTY: '',
    });
    expect(expanded.words).toEqual([
      'A=first second',
      'B=first second',
      'C=first second',
      'PATTERN=*.txt',
      'BRACES={one,two}',
      'EMPTY=',
    ]);
  });

  it('keeps the last assignment substitution status and does not persist command prefixes', async () => {
    const options = await fixture({ A: 'old' });
    const context = {
      ...options,
      async getWorkingDirectory() {
        return options.cwd;
      },
    };
    const producer = {
      ...shell,
      async runInSubshell() {
        return { stdout: '', stderr: '', code: 7 };
      },
    };
    const expanded = await expandCommandSegment(
      parseCommandLine('VALUE=$(produce) SECOND=tail')[0],
      context,
      producer
    );
    expect(expanded.assignmentOnly).toBe(true);
    expect(expanded.commandSubStatus).toBe(7);
    expect(options.env.VALUE).toBe('');
    expect(options.env.SECOND).toBe('tail');
    expect(
      (await expandCommandSegment(parseCommandLine('A=new echo command')[0], context, producer))
        .assignmentOnly
    ).toBeUndefined();
    expect(options.env.A).toBe('old');
    expect(
      (await expandCommandSegment(parseCommandLine("'QUOTED=data'")[0], context, producer))
        .assignmentOnly
    ).toBeUndefined();
    expect(options.env.QUOTED).toBeUndefined();
  });
});
