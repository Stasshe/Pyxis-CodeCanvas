import { PassThrough } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { fsClient } from '@/engine/core/fs/index';
import { setupTestProject } from '../../../../_helpers/testProject';

describe('Unix basics through the shell', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let rootPath = '';

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('UnixBasicsTest');
    repo = project.repo;
    rootPath = project.rootPath;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('prints unknown dash-prefixed echo text as an operand', async () => {
    const result = await shell.run('echo "---"');
    const optionTerminator = await shell.run('echo -- text');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('---\n');
    expect(optionTerminator.stdout).toBe('-- text\n');
  });

  it('prints parent directories for multiple paths', async () => {
    const result = await shell.run('dirname /home/pyxis/src/run-test.sh relative/file.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('/home/pyxis/src\nrelative\n');
  });

  it('reads piped input with head and tail when no file operand is given', async () => {
    const first = await shell.run("printf 'one\\ntwo\\nthree\\n' | head -n 1");
    const last = await shell.run("printf 'one\\ntwo\\nthree\\n' | tail -n 1");

    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toBe('one\n');
    expect(last.code, last.stderr).toBe(0);
    expect(last.stdout).toBe('three\n');
  });

  it('reads one standard-input operand alongside named head and tail files', async () => {
    await repo.writeFile(`${rootPath}/input.txt`, 'file\n');

    const head = await shell.run("printf 'stdin\\n' | head -n 1 - input.txt");
    const tail = await shell.run("printf 'stdin\\n' | tail -n 1 - input.txt");

    expect(head.code, head.stderr).toBe(0);
    expect(head.stdout).toBe("==> 'standard input' <==\nstdin\n\n==> input.txt <==\nfile\n");
    expect(tail.code, tail.stderr).toBe(0);
    expect(tail.stdout).toBe("==> 'standard input' <==\nstdin\n\n==> input.txt <==\nfile\n");
  });

  it('prints selected wc counts without default-column padding', async () => {
    await shell.run("printf 'one\\ntwo\\n' > wc-input.txt");

    const stdinCount = await shell.run("printf 'one\\ntwo\\n' | wc -l");
    const fileCount = await shell.run('wc -l wc-input.txt');

    expect(stdinCount.stdout).toBe('2\n');
    expect(fileCount.stdout).toBe('2 wc-input.txt\n');
  });

  it('applies interactive shell options and export assignments', async () => {
    const result = await shell.run(
      'set -o pipefail; export SHELL_VALUE=ready; echo "$SHELL_VALUE"'
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('ready\n');
  });

  it('preserves unquoted declaration assignment values from substitutions and variables', async () => {
    const result = await shell.run(
      'printf file > match.txt; export NAME=$(printf "first second *") PATTERN=*.txt EMPTY=; export COPY=$NAME; printf "<%s>\\n" "$NAME" "$COPY" "$PATTERN" "$EMPTY"'
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('<first second *>\n<first second *>\n<*.txt>\n<>\n');
  });

  it('persists multiple standalone assignments and expands each RHS after preceding writes', async () => {
    const result = await shell.run(
      'A="first second" B=$A C=$(printf "$B") PATTERN=*.txt BRACES={one,two} EMPTY=; printf "<%s>\\n" "$A" "$B" "$C" "$PATTERN" "$BRACES" "$EMPTY"'
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      '<first second>\n<first second>\n<first second>\n<*.txt>\n<{one,two}>\n<>\n'
    );
  });

  it('returns the last substitution status from multiple standalone assignments', async () => {
    const result = await shell.run('FIRST=$(false) SECOND=ready');

    expect(result.code, result.stderr).toBe(1);
    expect(shell.getEnv('FIRST')).toBe('');
    expect(shell.getEnv('SECOND')).toBe('ready');
  });

  it('preserves awk records and empty fields with an explicit separator', async () => {
    const record = await shell.run(`printf ' a  b \n' | awk '{print $0}'`);
    const fields = await shell.run(`printf ',a,,b,\n' | awk -F, '{print $1, $2, $3, $4, $5}'`);

    expect(record.code, record.stderr).toBe(0);
    expect(record.stdout).toBe(' a  b \n');
    expect(fields.code, fields.stderr).toBe(0);
    expect(fields.stdout).toBe(' a  b \n');
  });

  it('does not carry an idle interrupt into the next command', async () => {
    shell.killForeground();
    const result = await shell.run('echo alive');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('alive\n');
  });

  it('continues after an unknown command creates an empty redirected file', async () => {
    const stdin = new PassThrough();
    const result = await shell
      .getExecutor()
      .run('clear > clear.out; wc -c clear.out', undefined, { stdin });
    stdin.destroy();

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).toContain('clear: command not found');
    expect(result.stdout).toContain('0 clear.out');
  });

  it('does not wait for stdin when wc or sort has a file operand', async () => {
    await shell.run("printf 'b\\na\\n' > input.txt");
    const stdin = new PassThrough();

    const counted = await shell.getExecutor().run('wc -c input.txt', undefined, { stdin });
    const sorted = await shell.getExecutor().run('sort input.txt', undefined, { stdin });
    stdin.destroy();

    expect(counted.code, counted.stderr).toBe(0);
    expect(counted.stdout).toContain('4 input.txt');
    expect(sorted.code, sorted.stderr).toBe(0);
    expect(sorted.stdout).toContain('a');
    expect(sorted.stdout).toContain('b');
  });

  it('rejects invalid wc, sort, and awk input before reading stdin', async () => {
    const stdin = new PassThrough();
    const invalidWc = await shell.getExecutor().run('wc --invalid', undefined, { stdin });
    const invalidSort = await shell.getExecutor().run('sort --invalid', undefined, { stdin });
    const fileAwk = await shell
      .getExecutor()
      .run("awk '{print $1}' input.txt", undefined, { stdin });
    stdin.destroy();

    expect(invalidWc.code).not.toBe(0);
    expect(invalidWc.stderr).toContain('wc:');
    expect(invalidSort.code).not.toBe(0);
    expect(invalidSort.stderr).toContain('sort:');
    expect(fileAwk.code).not.toBe(0);
    expect(fileAwk.stderr).toContain('awk: file input is not supported');
  });

  it('preserves CRLF records and handles zero, negative, and short line counts', async () => {
    await shell.run("printf 'one\\r\\ntwo\\r\\nthree\\r\\n' > records.txt");

    const firstNone = await shell.run('head -n 0 records.txt');
    const firstTwo = await shell.run('head -n 2 records.txt');
    const firstTwoPlus = await shell.run('head -n +2 records.txt');
    const firstNonePlus = await shell.run('head -n +0 records.txt');
    const firstExceptLast = await shell.run('head -n -1 records.txt');
    const last = await shell.run('tail -1 records.txt');
    const lastNone = await shell.run('tail -n 0 records.txt');
    const invalid = await shell.run('head -n 1x records.txt');

    expect(firstNone.stdout).toBe('');
    expect(firstTwo.stdout).toBe('one\r\ntwo\r\n');
    expect(firstTwoPlus.stdout).toBe('one\r\ntwo\r\n');
    expect(firstNonePlus.stdout).toBe('');
    expect(firstExceptLast.stdout).toBe('one\r\ntwo\r\n');
    expect(last.stdout).toBe('three\r\n');
    expect(lastNone.stdout).toBe('');
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('head: invalid number of lines');
  });

  it('counts head and tail bytes in UTF-8 without decoding partial code points', async () => {
    await shell.run("printf '😀X' > unicode.txt");

    const head = await shell.run('head -c 2 unicode.txt > head.bin');
    const tail = await shell.run('tail -c 2 unicode.txt > tail.bin');
    const stdinHead = await shell.run("printf '😀X' | head -c 2 > stdin-head.bin");
    const stdinTail = await shell.run("printf '😀X' | tail -c 2 > stdin-tail.bin");

    expect(head.code).toBe(0);
    expect(tail.code).toBe(0);
    expect(stdinHead.code).toBe(0);
    expect(stdinTail.code).toBe(0);
    expect([...(await fsClient.readFile(`${rootPath}/head.bin`))]).toEqual([0xf0, 0x9f]);
    expect([...(await fsClient.readFile(`${rootPath}/tail.bin`))]).toEqual([0x80, 0x58]);
    expect([...(await fsClient.readFile(`${rootPath}/stdin-head.bin`))]).toEqual([0xf0, 0x9f]);
    expect([...(await fsClient.readFile(`${rootPath}/stdin-tail.bin`))]).toEqual([0x80, 0x58]);
  });

  it('keeps successful cat input when another operand fails and formats line options', async () => {
    await shell.run("printf 'a\\tb\\n\\nlast' > records.txt");
    await shell.run("printf 'first\\n' > first.txt; printf 'second\\n' > second.txt");

    const formatted = await shell.run('cat -n -E -T records.txt');
    const acrossFiles = await shell.run('cat -n -E first.txt second.txt');
    const partial = await shell.run('cat records.txt missing.txt');

    expect(formatted.code).toBe(0);
    expect(formatted.stdout).toBe('     1\ta^Ib$\n     2\t$\n     3\tlast');
    expect(acrossFiles.stdout).toBe('     1\tfirst$\n     2\tsecond$\n');
    expect(partial.code).toBe(1);
    expect(partial.stdout).toBe('a\tb\n\nlast');
    expect(partial.stderr).toContain('cat: missing.txt:');
  });

  it('keeps ls errors on stderr with status 2 and terminates line-oriented output', async () => {
    await shell.run('mkdir listing; touch listing/a listing/b listing/c');

    const partial = await shell.run('ls listing missing-directory');
    const count = await shell.run('ls listing | wc -l');
    const pwd = await shell.run('pwd; pwd');

    expect(partial.code).toBe(2);
    expect(partial.stdout).toContain('a');
    expect(partial.stderr).toContain("ls: cannot access 'missing-directory'");
    expect(count.code).toBe(0);
    expect(count.stdout).toContain('3');
    expect(pwd.stdout.split('\n')).toHaveLength(3);
    expect(pwd.stdout.endsWith('\n')).toBe(true);
  });

  it('uses silent file-operation success and returns test syntax status 2', async () => {
    await shell.run("printf 'data\\n' > source.txt");

    const silent = await shell.run('cp source.txt copy.txt; mv copy.txt moved.txt; rm moved.txt');
    const validInteger = await shell.run('test -03 -eq -3');
    const invalidInteger = await shell.run('test 3 -eq three');
    const extraOperand = await shell.run('test one two');

    expect(silent.code).toBe(0);
    expect(silent.stdout).toBe('');
    expect(silent.stderr).toBe('');
    expect(validInteger.code).toBe(0);
    expect(invalidInteger.code).toBe(2);
    expect(invalidInteger.stderr).toContain('integer expression expected');
    expect(extraOperand.code).toBe(2);
    expect(extraOperand.stderr).toContain('syntax error');

    const missingRightOperand = await shell.run('test one =');
    const extraFileOperand = await shell.run('[ -f source.txt extra ]');
    const emptyString = await shell.run('test ""');
    const emptyComparison = await shell.run('test "" = ""');
    const negatedEmptyString = await shell.run('test ! ""');
    const emptyFileOperand = await shell.run('test -f ""');
    expect(missingRightOperand.code).toBe(2);
    expect(extraFileOperand.code).toBe(2);
    expect(emptyString.code).toBe(1);
    expect(emptyComparison.code).toBe(0);
    expect(negatedEmptyString.code).toBe(0);
    expect(emptyFileOperand.code).toBe(1);
  });

  it('preserves grep matches verbatim and derives quiet and no-match statuses', async () => {
    await shell.run("printf 'grep: matching data\\n\\nneedle\\n' > grep-data.txt");

    const matchingErrorText = await shell.run('grep "grep:" grep-data.txt');
    const blankMatch = await shell.run('grep "^$" grep-data.txt');
    const quietMatch = await shell.run('grep -q needle grep-data.txt');
    const noMatch = await shell.run('grep absent grep-data.txt');

    expect(matchingErrorText.code).toBe(0);
    expect(matchingErrorText.stdout).toBe('grep: matching data\n');
    expect(blankMatch.code).toBe(0);
    expect(blankMatch.stdout).toBe('\n');
    expect(quietMatch.code).toBe(0);
    expect(quietMatch.stdout).toBe('');
    expect(noMatch.code).toBe(1);
    expect(noMatch.stdout).toBe('');
  });

  it('dispatches xargs argv directly, preserves NUL-delimited spaces, and maps failures', async () => {
    await shell.run("printf 'data\\n' > known.txt");

    const spaced = await shell.run("printf 'two words\\0one\\0' | xargs -0 -n 1 printf '<%s>\\n'");
    const partialFailure = await shell.run(
      'printf "missing.txt\\nknown.txt\\n" | xargs -n 1 -P 2 cat'
    );

    expect(spaced.code).toBe(0);
    expect(spaced.stdout).toBe('<two words>\n<one>\n');
    expect(partialFailure.code).toBe(123);
    expect(partialFailure.stdout).toBe('data\n');
    expect(partialFailure.stderr).toContain('cat: missing.txt:');
  });
});
