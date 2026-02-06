import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell script while-loop edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('WhileTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  const runScript = async (script: string) => {
    await createFile(ctx.projectId, '/test.sh', script);
    return ctx.shell.run('sh /test.sh');
  };

  describe('counter-based loops', () => {
    it('counts from 0 to 2', async () => {
      const r = await runScript([
        'i=0',
        'while test $i -lt 3',
        'do',
        'echo $i',
        'i=$((i + 1))',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('0');
      expect(r.stdout).toContain('1');
      expect(r.stdout).toContain('2');
      expect(r.stdout).not.toContain('3');
    });

    it('counts down from 5 to 1', async () => {
      const r = await runScript([
        'n=5',
        'while test $n -gt 0',
        'do',
        'echo $n',
        'n=$((n - 1))',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('5');
      expect(r.stdout).toContain('1');
      expect(r.stdout).not.toContain('0');
    });
  });

  describe('condition edge cases', () => {
    it('false condition never enters body', async () => {
      const r = await runScript([
        'while test 1 -eq 2',
        'do',
        'echo nope',
        'done',
        'echo after',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain('nope');
      expect(r.stdout).toContain('after');
    });

    it('negated condition with !', async () => {
      const r = await runScript([
        'i=3',
        'while ! test $i -eq 0',
        'do',
        'i=$((i - 1))',
        'echo $i',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('2');
      expect(r.stdout).toContain('1');
      expect(r.stdout).toContain('0');
    });
  });

  describe('break and continue', () => {
    it('break exits while loop', async () => {
      const r = await runScript([
        'i=0',
        'while true',
        'do',
        'if test $i -eq 3; then break; fi',
        'echo $i',
        'i=$((i + 1))',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('0');
      expect(r.stdout).toContain('1');
      expect(r.stdout).toContain('2');
      expect(r.stdout).not.toContain('3');
    });

    it('continue skips rest of body', async () => {
      const r = await runScript([
        'i=0',
        'while test $i -lt 5',
        'do',
        'i=$((i + 1))',
        'if test $i -eq 3; then continue; fi',
        'echo $i',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('1');
      expect(r.stdout).toContain('2');
      expect(r.stdout).not.toContain('3');
      expect(r.stdout).toContain('4');
      expect(r.stdout).toContain('5');
    });
  });

  describe('nested while loops', () => {
    it('two nested while loops produce cartesian-like output', async () => {
      const r = await runScript([
        'i=0',
        'while test $i -lt 2',
        'do',
        'j=0',
        'while test $j -lt 2',
        'do',
        'echo "$i-$j"',
        'j=$((j + 1))',
        'done',
        'i=$((i + 1))',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('0-0');
      expect(r.stdout).toContain('0-1');
      expect(r.stdout).toContain('1-0');
      expect(r.stdout).toContain('1-1');
    });
  });

  describe('infinite loop protection', () => {
    it('MAX_LOOP guard prevents hang on while true', async () => {
      const r = await runScript('while true; do true; done\necho unreachable');
      // Should terminate due to MAX_LOOP (10000 iterations)
      expect(r.code).toBe(0);
    }, 30000);
  });
});
