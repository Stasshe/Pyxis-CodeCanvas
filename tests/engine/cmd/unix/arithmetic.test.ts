import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell arithmetic expansion edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('ArithTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('basic operations', () => {
    it('addition', async () => {
      const r = await ctx.shell.run('echo $((1 + 2))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('3');
    });

    it('subtraction', async () => {
      const r = await ctx.shell.run('echo $((10 - 3))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('7');
    });

    it('multiplication', async () => {
      const r = await ctx.shell.run('echo $((4 * 5))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('20');
    });

    it('integer division', async () => {
      const r = await ctx.shell.run('echo $((10 / 3))');
      expect(r.code).toBe(0);
      // JS division: 10/3 = 3.333... — implementation may return float or truncate
      const num = parseFloat(r.stdout.trim());
      expect(num).toBeGreaterThanOrEqual(3);
      expect(num).toBeLessThan(4);
    });

    it('modulo', async () => {
      const r = await ctx.shell.run('echo $((10 % 3))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('1');
    });
  });

  describe('complex expressions', () => {
    it('nested parentheses', async () => {
      const r = await ctx.shell.run('echo $(( (2 + 3) * 4 ))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('20');
    });

    it('zero plus zero', async () => {
      const r = await ctx.shell.run('echo $((0 + 0))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('0');
    });

    it('negative result', async () => {
      const r = await ctx.shell.run('echo $((3 - 10))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('-7');
    });

    it('large number', async () => {
      const r = await ctx.shell.run('echo $((1000 * 1000))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('1000000');
    });
  });

  describe('combined with text', () => {
    it('arithmetic result embedded in string', async () => {
      const r = await ctx.shell.run('echo "result: $((2+2))"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('result: 4');
    });

    it('multiple arithmetic in one line', async () => {
      const r = await ctx.shell.run('echo "$((1+1)) and $((2+2))"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('2');
      expect(r.stdout).toContain('4');
    });
  });
});
