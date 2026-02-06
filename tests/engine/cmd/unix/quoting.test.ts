import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell quoting edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('QuoteTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('single quotes', () => {
    it('preserves literal text including special chars', async () => {
      const r = await ctx.shell.run("echo '|&&||>><'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('|&&||>><');
    });

    it('preserves dollar sign literally', async () => {
      ctx.shell.setEnv('FOO', 'bar');
      const r = await ctx.shell.run("echo '$FOO'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('$FOO');
      expect(r.stdout).not.toContain('bar');
    });

    it('preserves backticks literally', async () => {
      const r = await ctx.shell.run("echo '`echo nope`'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('`echo nope`');
    });

    it('empty single-quoted string', async () => {
      const r = await ctx.shell.run("echo ''");
      expect(r.code).toBe(0);
      // echo with empty arg outputs just a newline
      expect(r.stdout).toBe('\n');
    });
  });

  describe('double quotes', () => {
    it('preserves spaces', async () => {
      const r = await ctx.shell.run('echo "hello   world"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello   world');
    });

    it('empty double-quoted string', async () => {
      const r = await ctx.shell.run('echo ""');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('\n');
    });

    it('whitespace-only in double quotes preserved', async () => {
      const r = await ctx.shell.run('echo "   "');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('   ');
    });

    it('single quotes inside double quotes are literal', async () => {
      const r = await ctx.shell.run(`echo "it's a 'test'"`);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("it's a 'test'");
    });

    it('backslash within double quotes', async () => {
      const r = await ctx.shell.run('echo "back\\\\slash"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('\\');
    });
  });

  describe('mixed and adjacent quotes', () => {
    it('adjacent quoted segments are concatenated', async () => {
      const r = await ctx.shell.run(`echo "hello"'world'`);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('helloworld');
    });

    it('mixing single and double quotes across args', async () => {
      const r = await ctx.shell.run(`echo "double" 'single'`);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('double');
      expect(r.stdout).toContain('single');
    });

    it('double quotes containing escaped double quote', async () => {
      const r = await ctx.shell.run('echo "say \\"hello\\""');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('"');
    });
  });

  describe('backslash escaping', () => {
    it('backslash-escaped space joins words', async () => {
      const r = await ctx.shell.run('echo hello\\ world');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello world');
    });

    it('backslash at end of unquoted token', async () => {
      // trailing backslash may be treated as line continuation or error
      const r = await ctx.shell.run('echo test\\');
      expect(r.code).toBe(0);
    });
  });

  describe('echo -e flag special sequences', () => {
    it('\\n produces newline', async () => {
      const r = await ctx.shell.run('echo -e "a\\nb"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a\nb');
    });

    it('\\t produces tab', async () => {
      const r = await ctx.shell.run('echo -e "a\\tb"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a\tb');
    });
  });

  describe('variable expansion in quotes', () => {
    it('double quotes allow variable expansion', async () => {
      ctx.shell.setEnv('VAR', 'expanded');
      const r = await ctx.shell.run('echo "$VAR"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('expanded');
    });

    it('single quotes prevent variable expansion', async () => {
      ctx.shell.setEnv('VAR', 'expanded');
      const r = await ctx.shell.run("echo '$VAR'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('$VAR');
      expect(r.stdout).not.toContain('expanded');
    });
  });
});
