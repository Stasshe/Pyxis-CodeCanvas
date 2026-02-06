import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell error handling edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('ErrorTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('command not found', () => {
    it('returns exit code 127 for unknown command', async () => {
      const r = await ctx.shell.run('totally_nonexistent_command_xyz');
      expect(r.code).toBe(127);
      expect(r.stderr).toContain('command not found');
      expect(r.stdout).toBe('');
    });

    it('returns 127 for command with special chars', async () => {
      const r = await ctx.shell.run('no-such-cmd-999');
      expect(r.code).toBe(127);
      expect(r.stderr).toContain('command not found');
    });
  });

  describe('empty and whitespace input', () => {
    it('empty string returns code 0', async () => {
      const r = await ctx.shell.run('');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    });

    it('whitespace-only string returns code 0', async () => {
      const r = await ctx.shell.run('   ');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    });

    it('tab-only string returns code 0', async () => {
      const r = await ctx.shell.run('\t');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe('');
    });
  });

  describe('parse errors', () => {
    it('unterminated single quote returns code 2', async () => {
      const r = await ctx.shell.run("echo 'unclosed");
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('Parse error');
      expect(r.stdout).toBe('');
    });

    it('unterminated double quote returns code 2', async () => {
      const r = await ctx.shell.run('echo "unclosed');
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('Parse error');
      expect(r.stdout).toBe('');
    });

    it('unterminated backtick returns code 2', async () => {
      const r = await ctx.shell.run('echo `unclosed');
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('Parse error');
      expect(r.stdout).toBe('');
    });
  });

  describe('exit command edge cases', () => {
    it('exit 0 returns code 0', async () => {
      const r = await ctx.shell.run('exit 0');
      expect(r.code).toBe(0);
    });

    it('exit 42 returns code 42', async () => {
      const r = await ctx.shell.run('exit 42');
      expect(r.code).toBe(42);
    });

    it('exit 255 returns code 255', async () => {
      const r = await ctx.shell.run('exit 255');
      expect(r.code).toBe(255);
    });

    it('exit 256 wraps to 0 (8-bit mask)', async () => {
      const r = await ctx.shell.run('exit 256');
      expect(r.code).toBe(0);
    });

    it('exit with non-numeric argument returns code 2', async () => {
      const r = await ctx.shell.run('exit abc');
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('numeric argument required');
    });

    it('exit with too many arguments returns code 1', async () => {
      const r = await ctx.shell.run('exit 1 2');
      expect(r.code).toBe(1);
      expect(r.stderr).toContain('too many arguments');
    });

    it('exit with negative value wraps correctly', async () => {
      const r = await ctx.shell.run('exit -1');
      // -1 & 0xff = 255
      expect(r.code).toBe(255);
    });
  });

  describe('semicolons as statement separators', () => {
    it('multiple commands separated by semicolons', async () => {
      const r = await ctx.shell.run('echo a; echo b; echo c');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a');
      expect(r.stdout).toContain('b');
      expect(r.stdout).toContain('c');
    });

    it('failure in first command does not prevent second', async () => {
      const r = await ctx.shell.run('nonexistent_cmd; echo still_runs');
      expect(r.stdout).toContain('still_runs');
    });

    it('trailing semicolon is harmless', async () => {
      const r = await ctx.shell.run('echo hello;');
      expect(r.stdout).toContain('hello');
      expect(r.code).toBe(0);
    });
  });

  describe('builtin argument validation', () => {
    it('cat nonexistent file returns error', async () => {
      const r = await ctx.shell.run('cat /absolutely_nonexistent_file_xyz.txt');
      expect(r.code).not.toBe(0);
    });

    it('cd to nonexistent directory returns error', async () => {
      const r = await ctx.shell.run('cd /no_such_directory_xyz');
      expect(r.code).not.toBe(0);
    });

    it('type with no operand returns error', async () => {
      const r = await ctx.shell.run('type');
      expect(r.code).not.toBe(0);
    });

    it('type for unknown command returns error', async () => {
      const r = await ctx.shell.run('type nonexistent_xyz');
      expect(r.code).not.toBe(0);
    });

    it('sh with no arguments returns code 2', async () => {
      const r = await ctx.shell.run('sh');
      expect(r.code).toBe(2);
      expect(r.stderr).toContain('Usage');
    });

    it('sh with nonexistent file returns error', async () => {
      const r = await ctx.shell.run('sh /no_such_script.sh');
      expect(r.code).not.toBe(0);
      expect(r.stderr).toContain('No such file');
    });
  });
});
