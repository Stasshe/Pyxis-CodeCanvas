import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell script for-loop edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('ForLoopTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  const runScript = async (script: string, args: string[] = []) => {
    await createFile(ctx.projectId, '/test.sh', script);
    const cmd = args.length > 0 ? `sh /test.sh ${args.join(' ')}` : 'sh /test.sh';
    return ctx.shell.run(cmd);
  };

  describe('basic iteration', () => {
    it('iterates over space-separated list', async () => {
      const r = await runScript('for i in a b c\ndo\necho $i\ndone');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
      expect(r.stdout).toContain('c');
    });

    it('single-item list', async () => {
      const r = await runScript('for i in only\ndo\necho $i\ndone');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('only');
    });

    it('inline do on same line as for', async () => {
      const r = await runScript('for i in x y z; do echo $i; done');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('x');
      expect(r.stdout).toContain('y');
      expect(r.stdout).toContain('z');
    });
  });

  describe('brace expansion', () => {
    it('numeric range {1..5}', async () => {
      const r = await runScript('for i in {1..5}\ndo\necho $i\ndone');
      expect(r.code).toBe(0);
      for (const n of ['1', '2', '3', '4', '5']) {
        expect(r.stdout).toContain(n);
      }
    });

    it('comma-separated brace {a,b,c}', async () => {
      const r = await runScript('for i in {a,b,c}\ndo\necho $i\ndone');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
      expect(r.stdout).toContain('c');
    });
  });

  describe('break and continue', () => {
    it('break exits loop early', async () => {
      const r = await runScript([
        'for i in 1 2 3 4 5',
        'do',
        'if test $i -eq 3; then break; fi',
        'echo $i',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('1');
      expect(r.stdout).toContain('2');
      expect(r.stdout).not.toContain('3');
      expect(r.stdout).not.toContain('4');
    });

    it('continue skips current iteration', async () => {
      const r = await runScript([
        'for i in 1 2 3 4 5',
        'do',
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

  describe('nested loops', () => {
    it('two nested for loops', async () => {
      const r = await runScript([
        'for i in a b',
        'do',
        'for j in 1 2',
        'do',
        'echo $i$j',
        'done',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a1');
      expect(r.stdout).toContain('a2');
      expect(r.stdout).toContain('b1');
      expect(r.stdout).toContain('b2');
    });

    it('break in inner loop does not affect outer', async () => {
      const r = await runScript([
        'for i in a b',
        'do',
        'for j in 1 2 3',
        'do',
        'if test $j -eq 2; then break; fi',
        'echo $i$j',
        'done',
        'done',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a1');
      expect(r.stdout).toContain('b1');
      expect(r.stdout).not.toContain('a2');
      expect(r.stdout).not.toContain('b2');
    });
  });

  describe('variable persistence', () => {
    it('loop variable persists after loop ends', async () => {
      const r = await runScript([
        'for x in a b c',
        'do',
        'true',
        'done',
        'echo $x',
      ].join('\n'));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('c');
    });
  });

  describe('command substitution in list', () => {
    it('iterates over command output', async () => {
      const r = await runScript('for f in $(echo "x y z")\ndo\necho $f\ndone');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('x');
      expect(r.stdout).toContain('y');
      expect(r.stdout).toContain('z');
    });
  });

  describe('empty iteration', () => {
    it('empty list body never executes', async () => {
      const r = await runScript('for i in\ndo\necho nope\ndone\necho after');
      expect(r.code).toBe(0);
      expect(r.stdout).not.toContain('nope');
      expect(r.stdout).toContain('after');
    });
  });

  describe('MAX_LOOP protection', () => {
    it('very large range terminates without hang', async () => {
      const r = await runScript('for i in {1..20000}; do true; done\necho done');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('done');
    }, 30000);
  });
});
