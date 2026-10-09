import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('text utilities', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('TextUtilitiesTest');
    rootPath = project.rootPath;
    repo = project.repo;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  afterEach(async () => {
    await terminalCommandRegistry.clearAll();
  });

  it('translates, deletes, squeezes, and complements tr sets', async () => {
    const translated = await shell.run("printf 'aabbcc' | tr -s 'a-c' 'x-z'");
    const deleted = await shell.run("printf 'hello' | tr -d l");
    const squeezed = await shell.run("printf 'aaabbbccc' | tr -s a-c");
    const complementedSqueeze = await shell.run("printf 'aaabbbcccxxx' | tr -cs a-c");
    const complemented = await shell.run("printf 'abcxyz' | tr -cd 'a-c'");

    expect(translated.stdout).toBe('xyz');
    expect(deleted.stdout).toBe('heo');
    expect(squeezed.stdout).toBe('abc');
    expect(complementedSqueeze.stdout).toBe('aaabbbcccx');
    expect(complemented.stdout).toBe('abc');
  });

  it('collects repeated grep patterns and pattern files without treating files as patterns', async () => {
    await repo.writeFile(`${rootPath}/sample.txt`, 'alpha\nbeta\ngamma\n');
    await repo.writeFile(`${rootPath}/patterns.txt`, 'alpha\ngamma\n');
    await repo.writeFile(`${rootPath}/empty-patterns.txt`, '');
    await repo.writeFile(`${rootPath}/-fpattern`, 'match\n');

    const repeated = await shell.run('grep -e alpha -e beta sample.txt');
    const patternFile = await shell.run('grep -f patterns.txt sample.txt');
    const clusteredPatternFile = await shell.run('grep -ivf patterns.txt sample.txt');
    const emptyPatternFile = await shell.run('grep -f empty-patterns.txt sample.txt');
    const emptyPattern = await shell.run("grep -e '' sample.txt");
    const invertedOnlyMatching = await shell.run('grep -ov alpha sample.txt');
    const separatedInclude = await shell.run('grep --include -fpattern match -- -fpattern');
    const attachedInclude = await shell.run('grep --include=-fpattern match -- -fpattern');
    const separatedExclude = await shell.run('grep --exclude -fpattern match -- -fpattern');
    const attachedExclude = await shell.run('grep --exclude=-fpattern match -- -fpattern');

    expect(repeated.code).toBe(0);
    expect(repeated.stdout).toBe('alpha\nbeta\n');
    expect(patternFile.code).toBe(0);
    expect(patternFile.stdout).toBe('alpha\ngamma\n');
    expect(clusteredPatternFile.code).toBe(0);
    expect(clusteredPatternFile.stdout).toBe('beta\n');
    expect(emptyPatternFile.code).toBe(1);
    expect(emptyPatternFile.stdout).toBe('');
    expect(emptyPattern.code).toBe(0);
    expect(emptyPattern.stdout).toBe('alpha\nbeta\ngamma\n');
    expect(invertedOnlyMatching.code).toBe(0);
    expect(invertedOnlyMatching.stdout).toBe('');
    expect(separatedInclude.code, separatedInclude.stderr).toBe(0);
    expect(separatedInclude.stdout).toBe('match\n');
    expect(attachedInclude.code, attachedInclude.stderr).toBe(0);
    expect(attachedInclude.stdout).toBe('match\n');
    expect(separatedExclude.code).toBe(1);
    expect(separatedExclude.stdout).toBe('');
    expect(attachedExclude.code).toBe(1);
    expect(attachedExclude.stdout).toBe('');
  });

  it('formats implicit stdin like an explicit grep stdin operand for -l and -L', async () => {
    const implicitMatch = await shell.run("printf 'hit\\nmiss\\n' | grep -l hit");
    const explicitMatch = await shell.run("printf 'hit\\nmiss\\n' | grep -l hit -");
    const implicitWithoutMatch = await shell.run("printf 'hit\\nmiss\\n' | grep -l absent");
    const explicitWithoutMatch = await shell.run("printf 'hit\\nmiss\\n' | grep -l absent -");
    const implicitExcluded = await shell.run("printf 'hit\\nmiss\\n' | grep -L hit");
    const explicitExcluded = await shell.run("printf 'hit\\nmiss\\n' | grep -L hit -");
    const implicitListed = await shell.run("printf 'hit\\nmiss\\n' | grep -L absent");
    const explicitListed = await shell.run("printf 'hit\\nmiss\\n' | grep -L absent -");
    const countAndList = await shell.run("printf 'hit\\nmiss\\n' | grep -lc hit");

    expect(implicitMatch.code).toBe(0);
    expect(implicitMatch.stdout).toBe('(standard input)\n');
    expect(explicitMatch.code).toBe(0);
    expect(explicitMatch.stdout).toBe('(standard input)\n');
    expect(implicitWithoutMatch.code).toBe(1);
    expect(implicitWithoutMatch.stdout).toBe('');
    expect(explicitWithoutMatch.code).toBe(1);
    expect(explicitWithoutMatch.stdout).toBe('');
    expect(implicitExcluded.code).toBe(0);
    expect(implicitExcluded.stdout).toBe('');
    expect(explicitExcluded.code).toBe(0);
    expect(explicitExcluded.stdout).toBe('');
    expect(implicitListed.code).toBe(1);
    expect(implicitListed.stdout).toBe('(standard input)\n');
    expect(explicitListed.code).toBe(1);
    expect(explicitListed.stdout).toBe('(standard input)\n');
    expect(countAndList.code).toBe(0);
    expect(countAndList.stdout).toBe('(standard input)\n');
  });

  it('rejects conflicting grep matchers and applies final selectors and context overrides', async () => {
    await repo.writeFile(`${rootPath}/match.txt`, 'match\n');

    const conflict = await shell.run('grep -E -F match match.txt');
    const filesWithoutMatches = await shell.run('grep -l -L match match.txt');
    const filesWithMatches = await shell.run('grep -L -l match match.txt');
    const withFilename = await shell.run('grep -h -H match match.txt');
    const withoutFilename = await shell.run('grep -H -h match match.txt');
    const explicitAfter = await shell.run('seq 1 7 | grep -A1 -C2 4');
    const explicitZero = await shell.run('seq 1 7 | grep -A0 -C2 4');
    const invalidAfter = await shell.run('seq 1 3 | grep -A1foo 2');
    const invalidAfterSeparate = await shell.run('seq 1 3 | grep -A 1foo 2');
    const invalidAfterDashValue = await shell.run('seq 1 3 | grep -A -1foo 2');
    const invalidBefore = await shell.run('seq 1 3 | grep -B-1 2');
    const invalidContext = await shell.run('seq 1 3 | grep -C1x 2');

    expect(conflict.code).not.toBe(0);
    expect(conflict.stderr).toContain('conflicting matchers specified');
    expect(filesWithoutMatches.stdout).toBe('');
    expect(filesWithMatches.stdout).toBe('match.txt\n');
    expect(withFilename.stdout).toBe('match.txt:match\n');
    expect(withoutFilename.stdout).toBe('match\n');
    expect(explicitAfter.stdout).toBe('2\n3\n4\n5\n');
    expect(explicitZero.stdout).toBe('2\n3\n4\n');
    expect(invalidAfter.code).toBe(2);
    expect(invalidAfter.stderr).toContain("invalid context length argument: '1foo'");
    expect(invalidAfterSeparate.code).toBe(2);
    expect(invalidAfterSeparate.stderr).toContain("invalid context length argument: '1foo'");
    expect(invalidAfterDashValue.code).toBe(2);
    expect(invalidAfterDashValue.stderr).toContain("invalid context length argument: '-1foo'");
    expect(invalidBefore.code).toBe(2);
    expect(invalidBefore.stderr).toContain("invalid context length argument: '-1'");
    expect(invalidContext.code).toBe(2);
    expect(invalidContext.stderr).toContain("invalid context length argument: '1x'");
  });

  it('uses the last head and tail count, header, and alias options', async () => {
    await repo.writeFile(`${rootPath}/lines.txt`, 'one\ntwo\nthree\n');
    await repo.writeFile(`${rootPath}/no-newline.txt`, 'last');
    await repo.writeFile(`${rootPath}/-5`, 'literal');

    const headCount = await shell.run('head -n 2 -c 3 lines.txt');
    const headAlias = await shell.run('head -n1 --lines=2 lines.txt');
    const headHeader = await shell.run('head -q -v lines.txt lines.txt');
    const tailCount = await shell.run('tail -n 2 -c 3 lines.txt');
    const tailAlias = await shell.run('tail -n1 --lines=2 lines.txt');
    const tailHeader = await shell.run('tail -v -q lines.txt lines.txt');
    const literal = await shell.run('head -- -5');
    const separator = await shell.run('head -n 1 no-newline.txt lines.txt');

    expect(headCount.stdout).toBe('one');
    expect(headAlias.stdout).toBe('one\ntwo\n');
    expect(headHeader.stdout).toContain('==> lines.txt <==');
    expect(tailCount.stdout).toBe('ee\n');
    expect(tailAlias.stdout).toBe('two\nthree\n');
    expect(tailHeader.stdout).not.toContain('==> lines.txt <==');
    expect(literal.stdout).toBe('literal');
    expect(separator.stdout).toBe('==> no-newline.txt <==\nlast\n==> lines.txt <==\none\n');
  });

  it('prints verbose headers for stdin with implicit and explicit operands', async () => {
    const headImplicit = await shell.run("printf 'one\\ntwo\\n' | head -v -n1");
    const headExplicit = await shell.run("printf 'one\\ntwo\\n' | head -v -n1 -");
    const tailImplicit = await shell.run("printf 'one\\ntwo\\n' | tail -v -n1");
    const tailExplicit = await shell.run("printf 'one\\ntwo\\n' | tail -v -n1 -");
    const expectedHeader = "==> 'standard input' <==\none\n";

    expect(headImplicit.stdout).toBe(expectedHeader);
    expect(headExplicit.stdout).toBe(expectedHeader);
    expect(tailImplicit.stdout).toBe("==> 'standard input' <==\ntwo\n");
    expect(tailExplicit.stdout).toBe("==> 'standard input' <==\ntwo\n");
  });

  it('aligns wc counts by column when multiple files are listed', async () => {
    await repo.writeFile(`${rootPath}/one-line.txt`, 'one\n');
    await repo.writeFile(`${rootPath}/twelve-lines.txt`, `${Array(12).fill('line').join('\n')}\n`);

    const result = await shell.run('wc -lwm one-line.txt twelve-lines.txt');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      ' 1  1  4 one-line.txt\n12 12 60 twelve-lines.txt\n13 13 64 total\n'
    );

    await repo.writeFile(`${rootPath}/large-file.txt`, 'x'.repeat(1000));
    const metadataWidth = await shell.run('wc -l one-line.txt large-file.txt');

    expect(metadataWidth.code, metadataWidth.stderr).toBe(0);
    expect(metadataWidth.stdout).toBe('   1 one-line.txt\n   0 large-file.txt\n   1 total\n');
  });

  it('prints wc characters before bytes and counts GNU UTF-8 word separators', async () => {
    await repo.writeFile(`${rootPath}/unicode.txt`, '界\n');
    await repo.writeFile(
      `${rootPath}/word-separators.txt`,
      new TextEncoder().encode('\uFEFF\u00A0\u0085\u2060')
    );

    const order = await shell.run('wc -lwcm unicode.txt');
    const words = await shell.run('wc -w word-separators.txt');

    expect(order.stdout).toBe('1 1 2 4 unicode.txt\n');
    expect(words.stdout).toBe('2 word-separators.txt\n');
  });

  it('treats negative tail counts as counts from the end', async () => {
    await repo.writeFile(`${rootPath}/tail-input.txt`, 'one\ntwo\nthree\n');

    const lines = await shell.run('tail -n -2 tail-input.txt');
    const bytes = await shell.run('tail -c -4 tail-input.txt');

    expect(lines.code, lines.stderr).toBe(0);
    expect(lines.stdout).toBe('two\nthree\n');
    expect(bytes.code, bytes.stderr).toBe(0);
    expect(bytes.stdout).toBe('ree\n');
  });

  it('reads a grep standard-input operand alongside named files', async () => {
    await repo.writeFile(`${rootPath}/sample.txt`, 'file\n');

    const result = await shell.run("printf 'stdin\\n' | grep -n stdin - sample.txt");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('(standard input):1:stdin\n');
  });

  it('keeps grep no-match and suppressed errors silent and preserves output before file errors', async () => {
    await repo.writeFile(`${rootPath}/sample.txt`, 'alpha\n');

    const noMatch = await shell.run('grep absent sample.txt');
    const suppressedError = await shell.run('grep -s alpha missing.txt');
    const partial = await shell.run('grep alpha sample.txt missing.txt');

    expect(noMatch.code).toBe(1);
    expect(noMatch.stdout).toBe('');
    expect(noMatch.stderr).toBe('');
    expect(suppressedError.code).toBe(2);
    expect(suppressedError.stdout).toBe('');
    expect(suppressedError.stderr).toBe('');
    expect(partial.code).toBe(2);
    expect(partial.stdout).toBe('sample.txt:alpha\n');
    expect(partial.stderr).toContain('grep: missing.txt');
  });

  it('uses basic regular expressions by default and extended expressions with -E', async () => {
    await repo.writeFile(`${rootPath}/sample.txt`, 'a+b\naaab\n');

    const basic = await shell.run("grep 'a+b' sample.txt");
    const extended = await shell.run("grep -E 'a+b' sample.txt");

    expect(basic.stdout).toBe('a+b\n');
    expect(extended.stdout).toBe('aaab\n');
  });

  it('exposes the help paths implemented by grep, head, and tail', async () => {
    const grep = await shell.run('grep --help');
    const head = await shell.run('head --help');
    const tail = await shell.run('tail --help');

    expect(grep.code, grep.stderr).toBe(0);
    expect(grep.stdout).toContain('Usage: grep');
    expect(head.code, head.stderr).toBe(0);
    expect(head.stdout).toContain('Usage: head');
    expect(tail.code, tail.stderr).toBe(0);
    expect(tail.stdout).toContain('Usage: tail');
  });

  it('preserves a matched blank line in grep output', async () => {
    await repo.writeFile(`${rootPath}/blank.txt`, '\n');

    const result = await shell.run("grep '^$' blank.txt");

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('\n');
    expect(result.stderr).toBe('');
  });

  it('formats printf numbers and characters and preserves echo escape ordering', async () => {
    const formatted = await shell.run("printf '%04x %.2f %c\\n' 15 1.25 A");
    const escaped = await shell.run("echo -e 'a\\\\nb'");
    const literal = await shell.run('echo -E -h');

    expect(formatted.stdout).toBe('000f 1.25 A\n');
    expect(escaped.stdout).toBe('a\\nb\n');
    expect(literal.stdout).toBe('-h\n');
  });

  it('formats unsigned integers and general floating-point conversions like GNU printf', async () => {
    const result = await shell.run(
      "printf '%u %x %o %g %g %g %e %#g %#.1g %.1f\\n' -1 -1 -1 1.2 0.00001 1234567 1.2 1 0 -0"
    );

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe(
      '18446744073709551615 ffffffffffffffff 1777777777777777777777 1.2 1e-05 1.23457e+06 1.200000e+00 1.00000 0. -0.0\n'
    );
  });

  it('keeps seq decimal steps exact and accepts an attached separator', async () => {
    const result = await shell.run('seq -s, 0 0.1 0.3');

    expect(result.stdout).toBe('0.0,0.1,0.2,0.3\n');
  });

  it('preserves blank sort records and combines file operands without extra records', async () => {
    const empty = await shell.run("printf '' | sort");
    const oneBlank = await shell.run("printf '\\n' | sort");
    const twoBlank = await shell.run("printf '\\n\\n' | sort");
    await repo.writeFile(`${rootPath}/first.txt`, 'a\n');
    await repo.writeFile(`${rootPath}/second.txt`, 'b\n');
    const multipleFiles = await shell.run('sort first.txt second.txt');

    expect(empty.stdout).toBe('');
    expect(oneBlank.stdout).toBe('\n');
    expect(twoBlank.stdout).toBe('\n\n');
    expect(multipleFiles.stdout).toBe('a\nb\n');
  });

  it('handles descending sequences and decimal endpoints without float noise', async () => {
    const descending = await shell.run('seq 3 -1 1');
    const decimals = await shell.run('seq .1 .1 .3');
    const trailingDecimal = await shell.run('seq 1. 0.5 2');

    expect(descending.stdout).toBe('3\n2\n1\n');
    expect(decimals.stdout).toBe('0.1\n0.2\n0.3\n');
    expect(trailingDecimal.stdout).toBe('1.0\n1.5\n2.0\n');
  });

  it('keeps printf sign and radix prefixes before zero padding', async () => {
    const result = await shell.run("printf '%+08.2f %#06x' 1.25 15");

    expect(result.stdout).toBe('+0001.25 0x000f');
  });

  it('rejects unsupported tr options and malformed character classes', async () => {
    const option = await shell.run('printf x | tr -x a');
    const characterClass = await shell.run("printf x | tr '[:unknown:]' y");

    expect(option.code).not.toBe(0);
    expect(option.stderr).toContain('tr: invalid option');
    expect(characterClass.code).not.toBe(0);
    expect(characterClass.stderr).toContain('tr: invalid character class');
  });
});
