import git from 'isomorphic-git';
import { expect, it } from 'vitest';
import { add } from '@/engine/cmd/global/gitOperations/add';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

it('preserves an indexed executable mode when staging changed bytes', async () => {
  const core = new FsCore();
  await core.init(directoryTree());
  const fs = createGitFs(core);
  const dir = '/home/pyxis/executable-mode';
  await core.mkdir(dir, { recursive: true });
  await git.init({ fs, dir, defaultBranch: 'main' });
  await core.writeFile(`${dir}/run`, 'old');
  await git.add({ fs, dir, filepath: 'run' });
  const { oid } = await git.hashBlob({ object: new TextEncoder().encode('old') });
  await git.updateIndex({ fs, dir, filepath: 'run', oid, mode: 0o100755 });
  await core.writeFile(`${dir}/run`, 'changed');
  await add(fs, dir, 'run');
  let mode: number | undefined;
  await git.walk({
    fs,
    dir,
    trees: [git.STAGE()],
    map: async (path, [entry]) => {
      if (path === 'run' && entry) mode = await entry.mode();
    },
  });
  expect(mode).toBe(0o100755);
});
