import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell logical operator edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('LogicTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('&& (AND) operator', () => {
    it('runs second command when first succeeds', async () => {
      const r = await ctx.shell.run('echo first && echo second');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('first');
      expect(r.stdout).toContain('second');
    });

    it('skips second when first fails', async () => {
      const r = await ctx.shell.run('nonexistent_xyz && echo should_not_run');
      expect(r.stdout).not.toContain('should_not_run');
      expect(r.code).not.toBe(0);
    });

    it('three-command chain all succeed', async () => {
      const r = await ctx.shell.run('echo a && echo b && echo c');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
      expect(r.stdout).toContain('c');
    });

    it('chain stops at first failure', async () => {
      const r = await ctx.shell.run('echo a && nonexistent_cmd && echo c');
      expect(r.stdout).toContain('a');
      expect(r.stdout).not.toContain('c');
    });
  });

  describe('|| (OR) operator', () => {
    it('runs second when first fails', async () => {
      const r = await ctx.shell.run('nonexistent_xyz || echo fallback');
      expect(r.stdout).toContain('fallback');
    });

    it('skips second when first succeeds', async () => {
      const r = await ctx.shell.run('echo ok || echo should_not_run');
      expect(r.stdout).toContain('ok');
      expect(r.stdout).not.toContain('should_not_run');
    });

    it('chain stops at first success', async () => {
      const r = await ctx.shell.run('nonexistent1 || echo rescued || echo extra');
      expect(r.stdout).toContain('rescued');
    });

    it('all failing gives last exit code', async () => {
      const r = await ctx.shell.run('nonexistent1 || nonexistent2');
      expect(r.code).toBe(127);
    });
  });

  describe('mixed && and ||', () => {
    it('&& failure then || recovery', async () => {
      const r = await ctx.shell.run('echo yes && nonexistent_cmd || echo recovered');
      expect(r.stdout).toContain('yes');
      expect(r.stdout).toContain('recovered');
    });

    it('success skips OR, continues AND', async () => {
      const r = await ctx.shell.run('echo first || echo skip && echo third');
      expect(r.stdout).toContain('first');
      expect(r.stdout).not.toContain('skip');
    });
  });

  describe('with test/true commands', () => {
    it('true command enables && continuation', async () => {
      const r = await ctx.shell.run('true && echo success');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('success');
    });

    it('test 1 -eq 1 with &&', async () => {
      const r = await ctx.shell.run('test 1 -eq 1 && echo equal');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('equal');
    });

    it('test 1 -eq 2 fails, triggers ||', async () => {
      const r = await ctx.shell.run('test 1 -eq 2 || echo not_equal');
      expect(r.stdout).toContain('not_equal');
    });

    it('test with string equality', async () => {
      const r = await ctx.shell.run('test "hello" = "hello" && echo match');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('match');
    });

    it('test string inequality triggers ||', async () => {
      const r = await ctx.shell.run('test "a" = "b" || echo differ');
      expect(r.stdout).toContain('differ');
    });
  });
});
