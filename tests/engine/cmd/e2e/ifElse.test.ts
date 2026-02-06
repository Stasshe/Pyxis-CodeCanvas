import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell script if/elif/else edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('IfElseTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  const runScript = async (script: string) => {
    await createFile(ctx.projectId, '/test.sh', script);
    return ctx.shell.run('sh /test.sh');
  };

  describe('basic if', () => {
    it('if true executes body', async () => {
      const r = await runScript('if true; then\necho yes\nfi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('yes');
    });

    it('if false skips body', async () => {
      const r = await runScript('if test 1 -eq 2; then\necho nope\nfi\necho after');
      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain('nope');
      expect(r.stdout).toContain('after');
    });
  });

  describe('if-else', () => {
    it('false condition falls to else', async () => {
      const r = await runScript([
        'if test 1 -eq 2',
        'then',
        'echo yes',
        'else',
        'echo no',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('no');
      expect(r.stdout).not.toContain('yes');
    });

    it('true condition runs then, not else', async () => {
      const r = await runScript([
        'if test 1 -eq 1',
        'then',
        'echo yes',
        'else',
        'echo no',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('yes');
      expect(r.stdout).not.toContain('no');
    });
  });

  describe('if-elif-else', () => {
    it('matches second condition (elif)', async () => {
      const r = await runScript([
        'x=2',
        'if test $x -eq 1',
        'then',
        'echo one',
        'elif test $x -eq 2',
        'then',
        'echo two',
        'else',
        'echo other',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('two');
      expect(r.stdout).not.toContain('one');
      expect(r.stdout).not.toContain('other');
    });

    it('multiple elif, matches third', async () => {
      const r = await runScript([
        'x=3',
        'if test $x -eq 1; then',
        'echo a',
        'elif test $x -eq 2; then',
        'echo b',
        'elif test $x -eq 3; then',
        'echo c',
        'else',
        'echo d',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('c');
      expect(r.stdout).not.toContain('a');
      expect(r.stdout).not.toContain('b');
      expect(r.stdout).not.toContain('d');
    });

    it('no conditions match, falls to else', async () => {
      const r = await runScript([
        'x=99',
        'if test $x -eq 1; then',
        'echo a',
        'elif test $x -eq 2; then',
        'echo b',
        'else',
        'echo fallback',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('fallback');
    });
  });

  describe('nesting', () => {
    it('nested if inside if', async () => {
      const r = await runScript([
        'if true; then',
        'if true; then',
        'echo deep',
        'fi',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('deep');
    });

    it('three levels of nesting', async () => {
      const r = await runScript([
        'if true; then',
        'if true; then',
        'if true; then',
        'echo deepest',
        'fi',
        'fi',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('deepest');
    });

    it('nested if with outer false', async () => {
      const r = await runScript([
        'if test 1 -eq 2; then',
        'if true; then echo inner; fi',
        'fi',
        'echo outer',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain('inner');
      expect(r.stdout).toContain('outer');
    });
  });

  describe('negation', () => {
    it('! inverts true condition', async () => {
      const r = await runScript('if ! test 1 -eq 2; then\necho negated\nfi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('negated');
    });

    it('! inverts false condition to skip', async () => {
      const r = await runScript('if ! true; then\necho nope\nfi\necho after');
      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain('nope');
      expect(r.stdout).toContain('after');
    });
  });

  describe('test command conditions', () => {
    it('string equality with =', async () => {
      const r = await runScript('if test "hello" = "hello"; then echo match; fi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('match');
    });

    it('-z checks empty string', async () => {
      const r = await runScript('if test -z ""; then echo empty; fi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('empty');
    });

    it('-n checks non-empty string', async () => {
      const r = await runScript('if test -n "text"; then echo nonempty; fi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('nonempty');
    });

    it('-f checks file existence', async () => {
      await createFile(ctx.projectId, '/exists.txt', 'content');
      const r = await runScript('if test -f /exists.txt; then echo found; fi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('found');
    });

    it('-d checks directory existence', async () => {
      await ctx.shell.run('mkdir /mydir');
      const r = await runScript('if test -d /mydir; then echo isdir; fi');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('isdir');
    });
  });
});
