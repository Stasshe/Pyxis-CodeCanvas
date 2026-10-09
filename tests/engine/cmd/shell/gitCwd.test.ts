import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkerGitCommands } from '@/engine/cmd/global/gitOperations/worker';
import { UnixCommands } from '@/engine/cmd/global/unix';
import { StreamShell } from '@/engine/cmd/shell/streamShell';
import { FsCore } from '@/engine/core/fs/core';
import { directoryTree } from '../../../_helpers/opfs';

const mocks = vi.hoisted(() => ({ getGitCommands: vi.fn() }));
vi.mock('@/engine/cmd/terminalRegistry', () => ({
  terminalCommandRegistry: { getGitCommands: (root: string) => mocks.getGitCommands(root) },
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe('Git commands use the shell current directory', () => {
  it('initializes, stages, commits, and checks status after changing cwd', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    const workspace = '/home/pyxis/workspace';
    const checkout = '/home/pyxis/ui3-git';
    await core.mkdir(workspace, { recursive: true });
    await core.mkdir(checkout, { recursive: true });
    mocks.getGitCommands.mockImplementation((root: string) => new WorkerGitCommands(core, root));

    const shell = new StreamShell({
      rootPath: workspace,
      unix: new UnixCommands(workspace, core),
      fsClient: core,
    });
    const result = await shell.run(
      `cd ${checkout}; git init; printf 'tracked\\n' > file.txt; git add file.txt; git commit -m first; git status`
    );
    shell.dispose();

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toContain('On branch main');
    expect(result.stdout).toContain('working tree clean');
    expect((await core.stat(`${checkout}/.git`)).type).toBe('folder');
    await expect(core.stat(`${workspace}/.git`)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(mocks.getGitCommands).toHaveBeenCalledWith(checkout);
  });
});
