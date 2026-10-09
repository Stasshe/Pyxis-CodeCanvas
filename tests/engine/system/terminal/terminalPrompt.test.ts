import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeTerminalPrompt } from '@/engine/system/terminal/terminalPrompt';
import type { ThemeColors } from '@/context/ThemeContext';
import type { UnixCommands } from '@/engine/system/commands/unix';
import type { TerminalOutputManager } from '@/engine/system/terminal/terminalOutputManager';
import type { FsApi } from '@/engine/core/fs/index';

const mocks = vi.hoisted(() => ({ getGitCommands: vi.fn() }));
vi.mock('@/engine/system/terminal/terminalRegistry', () => ({
  terminalCommandRegistry: { getGitCommands: (root: string) => mocks.getGitCommands(root) },
}));

afterEach(() => vi.clearAllMocks());

const colors = { primary: '#123456', gitBranchColors: [] } as ThemeColors;

function filesystem(repositories: string[]): FsApi {
  return {
    stat: async path => {
      if (repositories.includes(path)) return { type: 'folder' };
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
  } as FsApi;
}

async function renderPrompt(cwd: string, fsClient: FsApi): Promise<string> {
  const output: string[] = [];
  const manager = {
    flush: async () => {},
    ensureNewline: async () => {},
    writeRaw: async (value: string) => output.push(value),
  } as unknown as TerminalOutputManager;
  const unix = { pwd: async () => cwd } as UnixCommands;
  await writeTerminalPrompt(manager, unix, fsClient, colors);
  return output.join('');
}

describe('terminal prompt Git branch', () => {
  it('omits a branch when cwd has no repository ancestor', async () => {
    const prompt = await renderPrompt('/home/pyxis/workspace', filesystem([]));

    expect(prompt).toBe('/home/pyxis/workspace $ ');
    expect(mocks.getGitCommands).not.toHaveBeenCalled();
  });

  it('uses the nearest repository root for a nested cwd', async () => {
    mocks.getGitCommands.mockReturnValue({ getCurrentBranch: async () => 'main' });

    const prompt = await renderPrompt(
      '/home/pyxis/project/packages/app',
      filesystem(['/home/pyxis/project/.git'])
    );

    expect(prompt).toContain('/home/pyxis/project/packages/app (');
    expect(prompt).toContain('main');
    expect(mocks.getGitCommands).toHaveBeenCalledWith('/home/pyxis/project');
  });

  it('queries the repository matching cwd after changing into another repository', async () => {
    const branches = new Map([
      ['/home/pyxis/workspace', 'feature/topic'],
      ['/home/pyxis/ui3-git', 'main'],
    ]);
    mocks.getGitCommands.mockImplementation((root: string) => ({
      getCurrentBranch: async () => branches.get(root),
    }));
    const fsClient = filesystem(['/home/pyxis/workspace/.git', '/home/pyxis/ui3-git/.git']);

    const workspacePrompt = await renderPrompt('/home/pyxis/workspace', fsClient);
    const otherPrompt = await renderPrompt('/home/pyxis/ui3-git', fsClient);

    expect(workspacePrompt).toContain('feature/topic');
    expect(otherPrompt).toContain('/home/pyxis/ui3-git (');
    expect(otherPrompt).toContain('main');
    expect(otherPrompt).not.toContain('feature/topic');
  });

  it('reads the branch on each prompt instead of retaining an earlier HEAD', async () => {
    let currentBranch = 'feature/topic';
    const getCurrentBranch = vi.fn(async () => currentBranch);
    mocks.getGitCommands.mockReturnValue({ getCurrentBranch });
    const fsClient = filesystem(['/home/pyxis/repository/.git']);

    const before = await renderPrompt('/home/pyxis/repository', fsClient);
    currentBranch = 'main';
    const after = await renderPrompt('/home/pyxis/repository', fsClient);

    expect(before).toContain('feature/topic');
    expect(after).toContain('main');
    expect(getCurrentBranch).toHaveBeenCalledTimes(2);
  });
});
