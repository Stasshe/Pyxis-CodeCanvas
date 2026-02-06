import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  readFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell redirection edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('RedirTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('stdout redirect >', () => {
    it('redirect creates file with content', async () => {
      const r = await ctx.shell.run('echo hello > /redir_out.txt');
      expect(r.code).toBe(0);
      // stdout is suppressed when redirected
      expect(r.stdout).toBe('');

      const content = await readFile(ctx.projectId, '/redir_out.txt');
      expect(content).not.toBeNull();
      expect(content).toContain('hello');
    });

    it('redirect overwrites existing file', async () => {
      await createFile(ctx.projectId, '/overwrite.txt', 'old content');
      const r = await ctx.shell.run('echo new > /overwrite.txt');
      expect(r.code).toBe(0);

      const content = await readFile(ctx.projectId, '/overwrite.txt');
      expect(content).toContain('new');
      expect(content).not.toContain('old content');
    });
  });

  describe('append redirect >>', () => {
    it('appends to existing file', async () => {
      await ctx.shell.run('echo first > /append.txt');
      await ctx.shell.run('echo second >> /append.txt');

      const content = await readFile(ctx.projectId, '/append.txt');
      expect(content).not.toBeNull();
      expect(content).toContain('first');
      expect(content).toContain('second');
    });

    it('append to nonexistent file creates it', async () => {
      const r = await ctx.shell.run('echo created >> /brand_new.txt');
      expect(r.code).toBe(0);

      const content = await readFile(ctx.projectId, '/brand_new.txt');
      expect(content).not.toBeNull();
      expect(content).toContain('created');
    });
  });

  describe('/dev/null', () => {
    it('redirect to /dev/null suppresses output', async () => {
      const r = await ctx.shell.run('echo secret > /dev/null');
      expect(r.code).toBe(0);
      expect(r.stdout).toBe('');
    });

    it('redirect to /dev/null does not create file', async () => {
      await ctx.shell.run('echo hidden > /dev/null');
      const content = await readFile(ctx.projectId, '/dev/null');
      expect(content).toBeNull();
    });
  });

  describe('stderr redirect 2>&1', () => {
    it('merges stderr into stdout', async () => {
      const r = await ctx.shell.run('nonexistent_cmd_xyz 2>&1');
      expect(r.code).toBe(127);
      // error message should appear in stdout after merge
      expect(r.stdout).toContain('command not found');
    });
  });

  describe('stdin redirect <', () => {
    it('reads input from file', async () => {
      await createFile(ctx.projectId, '/input.txt', 'hello world\n');
      const r = await ctx.shell.run('grep hello < /input.txt');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('hello world');
    });

    it('stdin from /dev/null provides empty input', async () => {
      const r = await ctx.shell.run('grep anything < /dev/null');
      expect(r.code).toBe(1);
    });
  });

  describe('pipe combined with redirect', () => {
    it('pipe result redirected to file', async () => {
      const r = await ctx.shell.run('echo -e "b\\na" | sort > /sorted.txt');
      expect(r.code).toBe(0);

      const content = await readFile(ctx.projectId, '/sorted.txt');
      expect(content).not.toBeNull();
      expect(content).toContain('a');
    });
  });
});
