import { describe, expect, it } from 'vitest';
import { ParseError, parseCommandLine } from '@/engine/system/shell/parser';
import { splitStatements } from '@/engine/system/shell/syntax';

describe('shell syntax', () => {
  it('distinguishes pipelines, lists, logical operators and background jobs', () => {
    const segments = parseCommandLine('echo a | cat; false && echo b || echo c & echo d');
    expect(segments.map(segment => segment.separator)).toEqual([
      '|',
      ';',
      '&&',
      '||',
      '&',
      undefined,
    ]);
  });

  it('keeps group statements and substitutions raw until execution', () => {
    const segments = parseCommandLine('(A=child; echo "$A"; echo $(echo nested)) > out');
    expect(segments[0].compound).toEqual({
      kind: 'subshell',
      source: 'A=child; echo "$A"; echo $(echo nested)',
    });
    expect(segments[0].redirections).toEqual([
      { kind: 'output', fd: 1, path: 'out', raw: 'out', append: false },
    ]);
  });

  it('recognizes redirection descriptors adjacent to group suffix operators', () => {
    const segments = parseCommandLine('{ echo ok; } 2>err');
    expect(segments[0].redirections).toEqual([
      { kind: 'output', fd: 2, path: 'err', raw: 'err', append: false },
    ]);
  });

  it('retains quotes nested in a parameter operand as one word', () => {
    const segments = parseCommandLine('echo "${MISSING:-"a b"}"');
    expect(segments[0].tokens).toHaveLength(2);
    expect(segments[0].tokens[1].raw).toBe('"${MISSING:-"a b"}"');
  });

  it('preserves ordinary braces and comments in group bodies', () => {
    const segments = parseCommandLine('{ echo x{y; # } is a comment\necho done; }');
    expect(segments[0].compound?.source).toContain('echo x{y');
    expect(segments[0].compound?.source).toContain('echo done');
  });

  it('preserves functions, multiline groups and pipeline continuations as statements', () => {
    const source = 'f() {\necho first; echo second\n}\necho x |\ncat\n(echo one;\necho two)';
    expect(splitStatements(source)).toEqual([
      'f() {\necho first; echo second\n}',
      'echo x |\ncat',
      '(echo one;\necho two)',
    ]);
  });

  it('keeps a here-document with its command and protects syntax in the body', () => {
    const source = "cat <<'EOF'\n( raw $TEXT ; }\nEOF\necho after";
    expect(splitStatements(source)).toEqual(["cat <<'EOF'\n( raw $TEXT ; }\nEOF\n", 'echo after']);
    const segments = parseCommandLine(source);
    expect(segments[0].stdinText).toBe('( raw $TEXT ; }\n');
    expect(segments[0].stdinExpand).toBe(false);
    expect(segments[1].tokens[0].text).toBe('echo');
  });

  it('reports malformed syntax before any command executes', () => {
    expect(() => parseCommandLine('echo first; (echo second')).toThrow(ParseError);
    expect(() => parseCommandLine('echo first |')).toThrow(ParseError);
    expect(() => parseCommandLine('echo "unterminated')).toThrow(ParseError);
    expect(() => parseCommandLine('echo >')).toThrow(ParseError);
  });
  it('builds lexical control nodes and preserves compound suffix routing', () => {
    const segments = parseCommandLine('for x in then do done; do echo "$x"; done > out | wc -l');
    expect(segments[0].compound).toMatchObject({
      kind: 'for',
      variable: 'x',
      items: 'then do done',
      body: 'echo "$x";',
    });
    expect(segments[0].separator).toBe('|');
    expect(segments[0].redirections?.[0]).toMatchObject({ kind: 'output', path: 'out' });
    expect(segments[1].tokens[0].text).toBe('wc');
  });

  it('keeps quoted control words as arguments in nested control conditions', () => {
    const source =
      'if [ "then" = then ]; then while false; do echo "done"; done; elif true; then echo "do"; else echo fi; fi';
    const compound = parseCommandLine(source)[0].compound;
    expect(compound).toMatchObject({
      kind: 'if',
      branches: [
        { condition: '[ "then" = then ];', body: 'while false; do echo "done"; done;' },
        { condition: 'true;', body: 'echo "do";' },
      ],
      otherwise: 'echo fi;',
    });
    expect(splitStatements(source)).toEqual([source]);
  });

  it('recognizes control nodes after pipes and leading pipeline inversion', () => {
    const segments = parseCommandLine('! printf "a\\n" | while read x; do echo "$x"; done');
    expect(segments[0].inverted).toBe(true);
    expect(segments[1].compound).toMatchObject({
      kind: 'while',
      condition: 'read x;',
      body: 'echo "$x";',
    });
  });

  it('rejects incomplete and unsupported control syntax', () => {
    for (const source of [
      'if true; then echo x',
      'while true; do echo x',
      'for x in a; echo x',
      'until true; do echo x; done',
      'case x in x) echo x;; esac',
      'printf x <<< data',
      'for ((i=0;i<2;i++)); do echo x; done',
      "echo $'unterminated",
      "echo $(echo $'unterminated)",
    ]) {
      expect(() => parseCommandLine(source)).toThrow(ParseError);
    }
  });

  it('preserves ANSI-C quoting and extracts substitutions from arithmetic bodies', () => {
    const tokens = parseCommandLine("echo $'a\\\'b $(false)' $(( $(echo 2) + 1 ))")[0].tokens;
    expect(tokens[1].text).toBe("a'b $(false)");
    expect(tokens[1].cmdSubs).toBeUndefined();
    expect(tokens[2].cmdSubs?.[0].command).toBe('echo 2');
    expect(tokens[2].raw).toContain('$((');
  });
  it('keeps reserved words in redirection targets outside the grammar', () => {
    const compound = parseCommandLine('if > then; then echo yes; fi')[0].compound;
    expect(compound).toMatchObject({
      kind: 'if',
      branches: [{ condition: '> then;', body: 'echo yes;' }],
    });
    expect(parseCommandLine('> if')[0].redirections?.[0]).toMatchObject({ path: 'if' });
    expect(() => parseCommandLine('true | ! false')).toThrow(ParseError);
    expect(() => parseCommandLine('!')).toThrow(ParseError);
  });
});
