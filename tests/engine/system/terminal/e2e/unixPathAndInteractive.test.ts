import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import type { FsCore } from '@/engine/core/fs/core';
import { setupTestProject } from '../../../../_helpers/testProject';

describe('Unix path display and interactive flags', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;
  let rootPath: string;
  let repo: FsCore;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('UnixPathAndInteractiveTest');
    rootPath = project.rootPath;
    repo = project.repo;
    await project.repo.mkdir(`${rootPath}/t`);
    await project.repo.writeFile(`${rootPath}/t/file.txt`, 'content');
    await project.repo.writeFile(`${rootPath}/source.txt`, 'source');
    await project.repo.mkdir(`${rootPath}/source-dir`);
    await project.repo.writeFile(`${rootPath}/source-dir/entry.txt`, 'entry');
    await project.repo.writeFile(`${rootPath}/destination.txt`, 'destination');
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('keeps the find operand prefix in output', async () => {
    const result = await shell.run('find ./t');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('./t\n./t/file.txt\n');
  });

  it('reports unknown find predicates with a failing status', async () => {
    const result = await shell.run('find t -mtime +1 -name "*.txt"');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("find: unknown predicate '-mtime'");
    expect(result.stdout).toBe('');
  });

  it('rejects unsupported destructive predicates before walking files', async () => {
    const result = await shell.run('find t -delete');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("find: unknown predicate '-delete'");
    await expect(repo.readText(`${rootPath}/t/file.txt`)).resolves.toBe('content');
  });

  it('keeps the du operand prefix in output', async () => {
    const result = await shell.run('du ./t');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('\t./t/file.txt\n');
    expect(result.stdout).toMatch(/\t\.\/t\n$/);
  });

  it.each([
    ['cp -i t/file.txt t/copy.txt', 't/file.txt', 't/copy.txt'],
    ['mv -i t/file.txt t/moved.txt', 't/file.txt', 't/moved.txt'],
    ['rm -i t/file.txt', 't/file.txt', 't/file.txt'],
  ])('rejects %s before changing files', async (command, existingPath, absentPath) => {
    const result = await shell.run(command);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('interactive confirmation is not supported');
    await expect(repo.stat(`${rootPath}/${existingPath}`)).resolves.toBeDefined();
    if (absentPath !== existingPath) {
      await expect(repo.stat(`${rootPath}/${absentPath}`)).rejects.toThrow();
    }
  });

  it('continues copying valid operands after a missing source', async () => {
    const result = await shell.run('cp source.txt missing.txt t');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("cp: cannot stat 'missing.txt'");
    await expect(repo.readText(`${rootPath}/t/source.txt`)).resolves.toBe('source');
  });

  it('continues moving valid operands after a missing source', async () => {
    const result = await shell.run('mv source.txt missing.txt t');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("mv: cannot stat 'missing.txt'");
    await expect(repo.readText(`${rootPath}/t/source.txt`)).resolves.toBe('source');
    await expect(repo.stat(`${rootPath}/source.txt`)).rejects.toThrow();
  });

  it('does not replace a file with a directory using mv', async () => {
    const result = await shell.run('mv source-dir destination.txt');

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('cannot overwrite non-directory');
    await expect(repo.readText(`${rootPath}/destination.txt`)).resolves.toBe('destination');
    await expect(repo.readText(`${rootPath}/source-dir/entry.txt`)).resolves.toBe('entry');
  });
});
