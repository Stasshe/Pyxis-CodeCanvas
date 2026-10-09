import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { add, addAll } from '@/engine/system/git/add';
import { GitFileSystemHelper } from '@/engine/system/git/fileSystemHelper';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../_helpers/opfs';

async function repository() {
  const core = new FsCore();
  await core.init(directoryTree());
  const dir = '/home/pyxis/add';
  await core.mkdir(dir, { recursive: true });
  const fs = createGitFs(core);
  await git.init({ fs, dir, defaultBranch: 'main' });
  return { core, fs, dir };
}

const author = { name: 'Stasshe', email: 'stasshe@example.test' };

afterEach(() => vi.restoreAllMocks());

describe('git add', () => {
  it('does not re-stage staged changes or staged new files', async () => {
    const repo = await repository();
    await repo.core.writeFile(`${repo.dir}/tracked.txt`, 'base');
    await git.add({ ...repo, filepath: 'tracked.txt' });
    await git.commit({ ...repo, message: 'base', author });
    await repo.core.writeFile(`${repo.dir}/tracked.txt`, 'staged');
    await git.add({ ...repo, filepath: 'tracked.txt' });
    await repo.core.writeFile(`${repo.dir}/new.txt`, 'new');
    await git.add({ ...repo, filepath: 'new.txt' });
    const before = await git.statusMatrix(repo);

    const result = await addAll(repo.fs, repo.dir);

    expect(await git.statusMatrix(repo)).toEqual(before);
    expect(result).toContain('Added: 0 new, 0 modified, 0 deleted');
  });

  it('restages edited staged files and a reverted worktree to their current bytes', async () => {
    const repo = await repository();
    await repo.core.writeFile(`${repo.dir}/edited`, 'base');
    await repo.core.writeFile(`${repo.dir}/reverted`, 'base');
    await git.add({ ...repo, filepath: 'edited' });
    await git.add({ ...repo, filepath: 'reverted' });
    await git.commit({ ...repo, message: 'base', author });
    for (const path of ['edited', 'reverted', 'new']) {
      await repo.core.writeFile(`${repo.dir}/${path}`, 'staged');
      await git.add({ ...repo, filepath: path });
    }
    await repo.core.writeFile(`${repo.dir}/edited`, 'latest');
    await repo.core.writeFile(`${repo.dir}/new`, 'latest new');
    await repo.core.writeFile(`${repo.dir}/reverted`, 'base');
    await addAll(repo.fs, repo.dir);
    const expected = new Map([
      ['edited', 'latest'],
      ['new', 'latest new'],
      ['reverted', 'base'],
    ]);
    await git.walk({
      ...repo,
      trees: [git.STAGE()],
      map: async (path, [entry]) => {
        if (!entry || !expected.has(path)) return;
        const oid = await entry.oid();
        if (!oid) throw new Error('Indexed object missing');
        const { blob } = await git.readBlob({ ...repo, oid });
        expect(new TextDecoder().decode(blob)).toBe(expected.get(path));
        expected.delete(path);
      },
    });
    expect(expected.size).toBe(0);
  });

  it('reports individual staging failures after attempting remaining files', async () => {
    const repo = await repository();
    await repo.core.writeFile(`${repo.dir}/first.txt`, 'first');
    await repo.core.writeFile(`${repo.dir}/second.txt`, 'second');
    const addSpy = vi.spyOn(git, 'add');
    addSpy.mockImplementationOnce(async () => {
      throw new Error('write failed');
    });

    await expect(addAll(repo.fs, repo.dir)).rejects.toThrow('first.txt');

    expect(addSpy).toHaveBeenCalledTimes(2);
    expect(await git.statusMatrix(repo)).toContainEqual(['second.txt', 0, 2, 2]);
  });

  it('reports failed glob and directory staging instead of a success count', async () => {
    const globRepo = await repository();
    await globRepo.core.writeFile(`${globRepo.dir}/glob.txt`, 'glob');
    vi.spyOn(git, 'add').mockRejectedValueOnce(new Error('glob write failed'));

    await expect(add(globRepo.fs, globRepo.dir, '*.txt')).rejects.toThrow('glob.txt');

    vi.restoreAllMocks();
    const directoryRepo = await repository();
    await directoryRepo.core.mkdir(`${directoryRepo.dir}/nested`, { recursive: true });
    await directoryRepo.core.writeFile(`${directoryRepo.dir}/nested/file.txt`, 'file');
    vi.spyOn(git, 'add').mockRejectedValueOnce(new Error('directory write failed'));

    await expect(add(directoryRepo.fs, directoryRepo.dir, 'nested')).rejects.toThrow('file.txt');
  });

  it('matches glob patterns exactly and supports question marks', async () => {
    const repo = await repository();
    await repo.core.writeFile(`${repo.dir}/file.ts`, 'ts');
    await repo.core.writeFile(`${repo.dir}/file.tsx`, 'tsx');
    await repo.core.writeFile(`${repo.dir}/file.ts.bak`, 'backup');
    await repo.core.writeFile(`${repo.dir}/ab.ts`, 'two');
    await repo.core.writeFile(`${repo.dir}/a.ts`, 'one');

    await add(repo.fs, repo.dir, '*.ts');
    await add(repo.fs, repo.dir, '?.ts');

    expect(await git.statusMatrix(repo)).toEqual([
      ['a.ts', 0, 2, 2],
      ['ab.ts', 0, 2, 2],
      ['file.ts', 0, 2, 2],
      ['file.ts.bak', 0, 2, 0],
      ['file.tsx', 0, 2, 0],
    ]);
  });

  it('stages only deleted files that match the requested glob', async () => {
    const repo = await repository();
    for (const file of ['keep.ts', 'drop.js']) {
      await repo.core.writeFile(`${repo.dir}/${file}`, file);
      await git.add({ ...repo, filepath: file });
    }
    await git.commit({ ...repo, message: 'base', author });
    await repo.core.rm(`${repo.dir}/keep.ts`);
    await repo.core.rm(`${repo.dir}/drop.js`);

    await add(repo.fs, repo.dir, '*.ts');

    expect(await git.statusMatrix(repo)).toEqual([
      ['drop.js', 1, 0, 1],
      ['keep.ts', 1, 0, 0],
    ]);
  });

  it('walks dangling links without following them and prunes ignored directories', async () => {
    const repo = await repository();
    await repo.core.writeFile(`${repo.dir}/.gitignore`, 'ignored/\n');
    await repo.core.writeFile(`${repo.dir}/visible.ts`, 'visible');
    await repo.core.mkdir(`${repo.dir}/ignored`, { recursive: true });
    await repo.core.writeFile(`${repo.dir}/ignored/large.ts`, 'ignored');
    await repo.core.symlink('missing-target', `${repo.dir}/dangling`);

    const files = await GitFileSystemHelper.getAllFiles(repo.fs, repo.dir);

    expect(files).toContain('visible.ts');
    expect(files).not.toContain('ignored/large.ts');
    expect(files).toContain('dangling');
    await expect(add(repo.fs, repo.dir, '*.ts')).resolves.toContain('1 file');
    await expect(add(repo.fs, repo.dir, 'dangling')).resolves.toContain('Added dangling');
    expect(await git.statusMatrix(repo)).toContainEqual(['dangling', 0, 2, 2]);
  });
});
