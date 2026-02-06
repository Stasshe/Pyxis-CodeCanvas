import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell environment variables edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('VarTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('setEnv and getEnv', () => {
    it('set and retrieve a value', () => {
      ctx.shell.setEnv('MY_KEY', 'myval');
      expect(ctx.shell.getEnv('MY_KEY')).toBe('myval');
    });

    it('getEnv returns undefined for unset key', () => {
      expect(ctx.shell.getEnv('NEVER_SET_XYZ')).toBeUndefined();
    });

    it('overwriting a variable replaces value', () => {
      ctx.shell.setEnv('K', 'first');
      ctx.shell.setEnv('K', 'second');
      expect(ctx.shell.getEnv('K')).toBe('second');
    });
  });

  describe('$VAR expansion in echo', () => {
    it('expands set variable', async () => {
      ctx.shell.setEnv('GREETING', 'hello');
      const r = await ctx.shell.run('echo $GREETING');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello');
    });

    it('undefined variable expands to empty', async () => {
      const r = await ctx.shell.run('echo prefix${UNDEFINED_VAR_XYZ}suffix');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('prefixsuffix');
    });

    it('variable in double quotes expands', async () => {
      ctx.shell.setEnv('NAME', 'world');
      const r = await ctx.shell.run('echo "hello $NAME"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello world');
    });

    it('variable in single quotes does NOT expand', async () => {
      ctx.shell.setEnv('NAME', 'world');
      const r = await ctx.shell.run("echo 'hello $NAME'");
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('$NAME');
      expect(r.stdout).not.toContain('world');
    });
  });

  describe('${VAR} brace syntax', () => {
    it('brace syntax expands variable', async () => {
      ctx.shell.setEnv('X', 'test');
      const r = await ctx.shell.run('echo ${X}');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('test');
    });

    it('brace syntax adjacent to text', async () => {
      ctx.shell.setEnv('PREFIX', 'pre');
      const r = await ctx.shell.run('echo ${PREFIX}_suffix');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('pre_suffix');
    });
  });

  describe('special characters in variable values', () => {
    it('spaces in variable value', async () => {
      ctx.shell.setEnv('SPACED', 'a b c');
      const r = await ctx.shell.run('echo "$SPACED"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a b c');
    });

    it('PATH-like value with colons', async () => {
      ctx.shell.setEnv('MY_PATH', '/usr/bin:/usr/local/bin');
      const r = await ctx.shell.run('echo $MY_PATH');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('/usr/bin:/usr/local/bin');
    });

    it('variable value with equals sign', async () => {
      ctx.shell.setEnv('PAIR', 'key=value');
      const r = await ctx.shell.run('echo "$PAIR"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('key=value');
    });
  });
});
