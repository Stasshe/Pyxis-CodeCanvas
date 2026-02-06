import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  setupShellTest,
  teardownShellTest,
  createFile,
  readFile,
  type ShellTestContext,
} from '../../../_helpers/shellTestHelper';

describe('Shell file operations edge cases', () => {
  let ctx: ShellTestContext;

  beforeEach(async () => {
    ctx = await setupShellTest('FileOpTest');
  });

  afterEach(async () => {
    await teardownShellTest();
  });

  describe('mkdir', () => {
    it('mkdir -p creates nested directories', async () => {
      const r1 = await ctx.shell.run('mkdir -p /deep/nested/dir');
      expect(r1.code).toBe(0);

      const r2 = await ctx.shell.run('ls /deep/nested');
      expect(r2.code).toBe(0);
      expect(r2.stdout).toContain('dir');
    });

    it('mkdir on already-existing directory', async () => {
      await ctx.shell.run('mkdir /exists');
      const r = await ctx.shell.run('mkdir /exists');
      // may fail or no-op depending on implementation
      // just verify it doesn't crash
      expect(typeof r.code).toBe('number');
    });
  });

  describe('touch and cat', () => {
    it('touch creates empty file, cat reads it', async () => {
      const r1 = await ctx.shell.run('touch /touched.txt');
      expect(r1.code).toBe(0);

      const r2 = await ctx.shell.run('cat /touched.txt');
      expect(r2.code).toBe(0);
    });

    it('cat multiple files concatenates output', async () => {
      await createFile(ctx.projectId, '/a.txt', 'aaa');
      await createFile(ctx.projectId, '/b.txt', 'bbb');

      const r = await ctx.shell.run('cat /a.txt /b.txt');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('aaa');
      expect(r.stdout).toContain('bbb');
    });

    it('cat nonexistent file fails', async () => {
      const r = await ctx.shell.run('cat /ghost_file_xyz.txt');
      expect(r.code).not.toBe(0);
    });
  });

  describe('cp and mv', () => {
    it('cp copies file content', async () => {
      await createFile(ctx.projectId, '/src.txt', 'source content');
      const r1 = await ctx.shell.run('cp /src.txt /dst.txt');
      expect(r1.code).toBe(0);

      const r2 = await ctx.shell.run('cat /dst.txt');
      expect(r2.code).toBe(0);
      expect(r2.stdout).toContain('source content');
    });

    it('mv renames file', async () => {
      await createFile(ctx.projectId, '/old.txt', 'data');
      const r1 = await ctx.shell.run('mv /old.txt /new.txt');
      expect(r1.code).toBe(0);

      const r2 = await ctx.shell.run('cat /new.txt');
      expect(r2.code).toBe(0);
      expect(r2.stdout).toContain('data');

      const r3 = await ctx.shell.run('cat /old.txt');
      expect(r3.code).not.toBe(0);
    });
  });

  describe('rm', () => {
    it('rm removes file', async () => {
      await createFile(ctx.projectId, '/to_delete.txt', 'delete me');
      const r1 = await ctx.shell.run('rm /to_delete.txt');
      expect(r1.code).toBe(0);

      const r2 = await ctx.shell.run('cat /to_delete.txt');
      expect(r2.code).not.toBe(0);
    });

    it('rm -r removes directory recursively', async () => {
      await ctx.shell.run('mkdir -p /rmdir/sub');
      await createFile(ctx.projectId, '/rmdir/sub/f.txt', 'nested');
      const r1 = await ctx.shell.run('rm -r /rmdir');
      expect(r1.code).toBe(0);

      const r2 = await ctx.shell.run('ls /rmdir');
      expect(r2.code).not.toBe(0);
    });
  });

  describe('ls', () => {
    it('ls after mkdir shows new directory', async () => {
      await ctx.shell.run('mkdir /visible_dir');
      const r = await ctx.shell.run('ls /');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('visible_dir');
    });
  });

  describe('find', () => {
    it('find with -name pattern', async () => {
      await createFile(ctx.projectId, '/search/a.txt', 'a');
      await createFile(ctx.projectId, '/search/b.js', 'b');

      const r = await ctx.shell.run('find /search -name "*.txt"');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('a.txt');
      expect(r.stdout).not.toContain('b.js');
    });
  });

  describe('wc', () => {
    it('wc -l counts lines in file', async () => {
      await createFile(ctx.projectId, '/lines.txt', 'one\ntwo\nthree\n');
      const r = await ctx.shell.run('wc -l /lines.txt');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('3');
    });
  });

  describe('head and tail', () => {
    it('head -1 returns first line', async () => {
      await createFile(ctx.projectId, '/multi.txt', 'first\nsecond\nthird\n');
      const r = await ctx.shell.run('head -1 /multi.txt');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('first');
      expect(r.stdout).not.toContain('second');
    });

    it('tail -1 returns last line', async () => {
      await createFile(ctx.projectId, '/multi2.txt', 'first\nsecond\nthird');
      const r = await ctx.shell.run('tail -1 /multi2.txt');
      expect(r.code).toBe(0);
      expect(r.stdout).toContain('third');
    });
  });
});
