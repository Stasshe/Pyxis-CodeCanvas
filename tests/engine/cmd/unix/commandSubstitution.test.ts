import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell command substitution edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('CmdSubTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('$() syntax', () => {
    it('basic substitution', async () => {
      const r = await ctx.shell.run('echo $(echo hello)');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello');
    });

    it('nested substitution', async () => {
      const r = await ctx.shell.run('echo $(echo $(echo deep))');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('deep');
    });

    it('substitution with pipe inside', async () => {
      const r = await ctx.shell.run('echo $(echo -e "b\\na" | sort | head -1)');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
    });

    it('substitution in double quotes', async () => {
      const r = await ctx.shell.run('echo "user: $(whoami)"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('user:');
    });

    it('substitution result used as argument to cat', async () => {
      await createFile(ctx.projectId, '/readable.txt', 'content here');
      const r = await ctx.shell.run('cat $(echo /readable.txt)');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('content here');
    });

    it('substitution with no output', async () => {
      const r = await ctx.shell.run('echo before$(true)after');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('beforeafter');
    });

    it('substitution trims trailing newlines', async () => {
      const r = await ctx.shell.run('echo "$(echo hello)"');
      expect(r.code).toBe(0);
      // Should be "hello\n" not "hello\n\n"
      const lines = r.stdout.split('\n').filter(l => l.length > 0);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toBe('hello');
    });
  });

  describe('backtick syntax', () => {
    it('basic backtick substitution', async () => {
      const r = await ctx.shell.run('echo `echo world`');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('world');
    });

    it('backtick with pipe', async () => {
      const r = await ctx.shell.run('echo `echo -e "x\\ny" | head -1`');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('x');
    });
  });

  describe('single quotes prevent substitution', () => {
    it('$() in single quotes is literal', async () => {
      const r = await ctx.shell.run("echo '$(echo nope)'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('$(echo nope)');
      expect(r.stdout).not.toContain('nope\n');
    });

    it('backtick in single quotes is literal', async () => {
      const r = await ctx.shell.run("echo '`echo nope`'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('`echo nope`');
    });
  });
});
