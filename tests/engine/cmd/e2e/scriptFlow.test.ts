import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell script flow control edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('ScriptFlowTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  const runScript = async (script: string) => {
    await createFile(ctx.projectId, '/test.sh', script);
    return ctx.shell.run('sh /test.sh');
  };

  describe('semicolons', () => {
    it('semicolons separate statements in script', async () => {
      const r = await runScript('echo a; echo b; echo c');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
      expect(r.stdout).toContain('c');
    });
  });

  describe('comments', () => {
    it('comment lines are ignored', async () => {
      const r = await runScript('# this is a comment\necho visible');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('visible');
      expect(r.stdout).not.toContain('#');
    });

    it('script with only comments produces no output', async () => {
      const r = await runScript('# line1\n# line2\n# line3');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
    });
  });

  describe('empty script', () => {
    it('empty script returns code 0', async () => {
      const r = await runScript('');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
    });

    it('whitespace-only script returns code 0', async () => {
      const r = await runScript('   \n  \n');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
    });
  });

  describe('exit statement', () => {
    it('exit terminates script, skips remaining', async () => {
      const r = await runScript('echo before\nexit 0\necho after');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('before');
      expect(r.stdout).not.toContain('after');
    });

    it('exit with non-zero code', async () => {
      const r = await runScript('echo before\nexit 42');
      expect(r.code).toBe(42);
      expect(r.stdout).toContain('before');
    });

    it('exit 0 explicitly', async () => {
      const r = await runScript('exit 0');
      expect(r.code).toBe(0);
    });

    it('exit with too many args prints error but continues', async () => {
      const r = await runScript('exit 1 2\necho still_running');
      // too many args: error printed, script continues
      expect(r.stdout).toContain('still_running');
    });
  });

  describe('mixed control structures', () => {
    it('for loop inside if', async () => {
      const r = await runScript([
        'if true; then',
        'for i in a b',
        'do',
        'echo $i',
        'done',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
    });

    it('while loop inside if', async () => {
      const r = await runScript([
        'if true; then',
        'i=0',
        'while test $i -lt 2',
        'do',
        'echo $i',
        'i=$((i + 1))',
        'done',
        'fi',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('0');
      expect(r.stdout).toContain('1');
    });

    it('if inside for with break', async () => {
      const r = await runScript([
        'for i in 1 2 3 4 5',
        'do',
        'if test $i -eq 3; then break; fi',
        'echo $i',
        'done',
        'echo done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('1');
      expect(r.stdout).toContain('2');
      expect(r.stdout).not.toContain('3');
      expect(r.stdout).toContain('done');
    });

    it('sequential for loops', async () => {
      const r = await runScript([
        'for i in a; do echo $i; done',
        'for j in b; do echo $j; done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
    });
  });

  describe('complex scripts', () => {
    it('sum 1..10 using while loop', async () => {
      const r = await runScript([
        'sum=0',
        'i=1',
        'while test $i -le 10',
        'do',
        'sum=$((sum + i))',
        'i=$((i + 1))',
        'done',
        'echo $sum',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('55');
    });

    it('find even numbers in range using for + if', async () => {
      const r = await runScript([
        'for i in 1 2 3 4 5 6',
        'do',
        'if test $((i % 2)) -eq 0; then',
        'echo $i',
        'fi',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('2');
      expect(r.stdout).toContain('4');
      expect(r.stdout).toContain('6');
      expect(r.stdout).not.toContain('1');
      expect(r.stdout).not.toContain('3');
      expect(r.stdout).not.toContain('5');
    });

    it('script creates file and reads it back', async () => {
      const r = await runScript([
        'echo "hello world" > /created.txt',
        'cat /created.txt',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello world');
    });

    it('script with variable accumulation in loop', async () => {
      const r = await runScript([
        'result=""',
        'for w in hello world foo',
        'do',
        'result="$result $w"',
        'done',
        'echo $result',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello');
      expect(r.stdout).toContain('world');
      expect(r.stdout).toContain('foo');
    });

    it('countdown with early exit', async () => {
      const r = await runScript([
        'i=10',
        'while test $i -gt 0',
        'do',
        'if test $i -eq 7; then',
        'echo "stopping at $i"',
        'exit 0',
        'fi',
        'i=$((i - 1))',
        'done',
        'echo "should not reach here"',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('stopping at 7');
      expect(r.stdout).not.toContain('should not reach here');
    });
  });
});
