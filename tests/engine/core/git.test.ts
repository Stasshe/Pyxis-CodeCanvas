import git from 'isomorphic-git';
import { beforeEach, describe, expect, it } from 'vitest';
import { WorkerGitCommands } from '@/engine/cmd/global/gitOperations/worker';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs, repositoryPath } from '@/engine/core/fs/git';

describe('Git with the worker filesystem', () => {
  const root = '/tmp/repo';
  let core: FsCore;
  let commands: WorkerGitCommands;

  beforeEach(async () => {
    core = new FsCore();
    commands = new WorkerGitCommands(core, root);
    await commands.init();
  });

  it('commits files directly and restores branch content', async () => {
    await core.writeFile(`${root}/readme.md`, 'initial\n');
    await commands.add(`${root}/readme.md`);
    await commands.commit('Initial content');
    expect(await commands.status()).toContain('working tree clean');
    expect(await commands.getHeadFileContent(`${root}/readme.md`)).toBe('initial\n');

    await commands.checkout('feature', true);
    await core.writeFile(`${root}/readme.md`, 'feature\n');
    await commands.add('readme.md');
    expect(await commands.getStagedFileContent(`${root}/readme.md`)).toBe('feature\n');
    await commands.commit('Feature content');
    await commands.checkout('main');
    expect(await core.readText(`${root}/readme.md`)).toBe('initial\n');
    await commands.checkout('feature');
    expect(await core.readText(`${root}/readme.md`)).toBe('feature\n');
  });

  it('preserves binary data and untracked files during a hard reset', async () => {
    const bytes = new Uint8Array([0, 255, 128, 10, 13]);
    await core.writeFile(`${root}/image.bin`, bytes);
    await commands.add('image.bin');
    await commands.commit('Binary content');
    const fs = createGitFs(core);
    const oid = await git.resolveRef({ fs, dir: root, ref: 'HEAD' });
    const { blob } = await git.readBlob({ fs, dir: root, oid, filepath: 'image.bin' });
    expect(blob).toEqual(bytes);

    await core.writeFile(`${root}/image.bin`, new Uint8Array([42]));
    await core.writeFile(`${root}/draft.txt`, 'keep this draft');
    await commands.reset({ hard: true });
    expect(Array.from(await core.readFile(`${root}/image.bin`))).toEqual(Array.from(bytes));
    expect(await core.readText(`${root}/draft.txt`)).toBe('keep this draft');
    expect(await commands.getCurrentBranch()).toBe('main');
  });

  it('normalizes repository paths and rejects paths outside the root', async () => {
    expect(repositoryPath(root, '.')).toBe('.');
    expect(repositoryPath(root, 'file.ts')).toBe('file.ts');
    expect(repositoryPath(root, `${root}/src/file.ts`)).toBe('src/file.ts');
    expect(repositoryPath(root, './src/../file.ts')).toBe('file.ts');
    expect(repositoryPath(root, root)).toBe('.');
    expect(repositoryPath('/', '/src/file.ts')).toBe('src/file.ts');
    expect(() => repositoryPath(root, '/tmp/repository/file.ts')).toThrow('outside repository');
    expect(() => repositoryPath(root, '../outside.ts')).toThrow('outside repository');
    await expect(commands.getFileContentAtCommit('HEAD', '/tmp/outside.ts')).rejects.toThrow(
      'outside repository'
    );
  });

  it('removes empty directories while preserving nonempty directories', async () => {
    const fs = createGitFs(core);
    const directory = `${root}/nested`;
    await core.mkdir(directory);
    await core.writeFile(`${directory}/draft.txt`, 'keep');
    await expect(fs.promises.rmdir(directory)).rejects.toMatchObject({ code: 'ENOTEMPTY' });
    expect(await core.readText(`${directory}/draft.txt`)).toBe('keep');
    await fs.promises.unlink(`${directory}/draft.txt`);
    await fs.promises.rmdir(directory);
    expect(await core.exists(directory)).toBe(false);
  });
});
