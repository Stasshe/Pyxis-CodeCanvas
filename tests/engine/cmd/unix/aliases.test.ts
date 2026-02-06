import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell alias edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('AliasTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  it('basic alias expansion', async () => {
    ctx.shell.setAlias('greet', 'echo hello');
    const r = await ctx.shell.run('greet');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('hello');
  });

  it('alias with additional arguments appended', async () => {
    ctx.shell.setAlias('say', 'echo');
    const r = await ctx.shell.run('say world');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('world');
  });

  it('alias overwrite takes effect', async () => {
    ctx.shell.setAlias('x', 'echo first');
    ctx.shell.setAlias('x', 'echo second');
    const r = await ctx.shell.run('x');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('second');
    expect(r.stdout).not.toContain('first');
  });

  it('alias preserves exit code of expanded command', async () => {
    ctx.shell.setAlias('fail', 'nonexistent_command_xyz');
    const r = await ctx.shell.run('fail');
    expect(r.code).toBe(127);
    expect(r.stderr).toContain('command not found');
  });

  it('getAlias returns set alias', () => {
    ctx.shell.setAlias('ll', 'ls -la');
    expect(ctx.shell.getAlias('ll')).toBe('ls -la');
  });

  it('getAlias returns undefined for unset alias', () => {
    expect(ctx.shell.getAlias('never_set_xyz')).toBeUndefined();
  });

  it('alias with echo -n flag', async () => {
    ctx.shell.setAlias('ne', 'echo -n');
    const r = await ctx.shell.run('ne hello');
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('hello');
  });
});
