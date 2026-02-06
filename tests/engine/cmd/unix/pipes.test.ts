import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell pipe chain edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('PipeTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('basic two-command pipes', () => {
    it('echo piped to grep matching', async () => {
      const r = await ctx.shell.run('echo hello world | grep hello');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello world');
    });

    it('echo piped to grep non-matching returns code 1', async () => {
      const r = await ctx.shell.run('echo hello | grep nonexistent');
      expect(r.code).toBe(1);
    });

    it('pipe passes only stdout, not stderr', async () => {
      // command-not-found produces stderr; pipe should not forward it to next cmd's stdin
      const r = await ctx.shell.run('nonexistent_cmd | echo piped');
      expect(r.stdout).toContain('piped');
    });
  });

  describe('multi-stage pipes', () => {
    it('three-stage: echo | sort | head', async () => {
      const r = await ctx.shell.run('echo -e "c\\nb\\na" | sort | head -1');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
    });

    it('four-stage: echo | sort | head | tail', async () => {
      const r = await ctx.shell.run('echo -e "z\\na\\nm\\nb" | sort | head -2 | tail -1');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('b');
    });

    it('five-stage chain with sort -u and wc', async () => {
      const r = await ctx.shell.run('echo -e "foo\\nbar\\nbaz\\nfoo\\nbar" | sort | sort -u | grep -v baz | wc -l');
      expect(r.code).toBe(0);
      const count = parseInt(r.stdout.trim(), 10);
      expect(count).toBe(2);
    });
  });

  describe('pipe with wc', () => {
    it('wc -l counts lines from echo', async () => {
      const r = await ctx.shell.run('echo -e "a\\nb\\nc" | wc -l');
      expect(r.code).toBe(0);
      const count = parseInt(r.stdout.trim(), 10);
      expect(count).toBe(3);
    });

    it('wc -l on single line', async () => {
      const r = await ctx.shell.run('echo hello | wc -l');
      expect(r.code).toBe(0);
      const count = parseInt(r.stdout.trim(), 10);
      expect(count).toBe(1);
    });
  });

  describe('pipe edge cases', () => {
    it('pipe from empty echo output to grep', async () => {
      const r = await ctx.shell.run('echo -n "" | grep anything');
      expect(r.code).toBe(1);
    });

    it('pipe grep -v inverted match', async () => {
      const r = await ctx.shell.run('echo -e "yes\\nno\\nyes" | grep -v no');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('yes');
      expect(r.stdout).not.toContain('no');
    });

    it('pipe with echo -n (no trailing newline)', async () => {
      const r = await ctx.shell.run('echo -n hello | grep hello');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello');
    });

    it('echo with numeric sort pipe', async () => {
      const r = await ctx.shell.run('echo -e "10\\n2\\n1\\n20" | sort -n');
      expect(r.code).toBe(0);
      const lines = r.stdout.trim().split('\n').map(s => parseInt(s.trim(), 10));
      expect(lines).toEqual([1, 2, 10, 20]);
    });
  });
});
