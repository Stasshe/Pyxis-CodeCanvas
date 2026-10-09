import git from 'isomorphic-git';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitCloneOperations } from '@/engine/cmd/global/gitOperations/clone';
import { handleGitCommand } from '@/engine/cmd/handlers/gitHandler';
import { type DispatchOptions, dispatchCommand } from '@/engine/cmd/shell/commandDispatch';
import { Process } from '@/engine/cmd/shell/process';
import type { FsApi } from '@/engine/core/fs';
import { FsCore } from '@/engine/core/fs/core';
import { createGitFs } from '@/engine/core/fs/git';
import { directoryTree } from '../../../../_helpers/opfs';

const commands = vi.hoisted(() => ({
  clone: vi.fn(),
  init: vi.fn(),
  add: vi.fn(),
  checkout: vi.fn(),
  checkoutRemote: vi.fn(),
  reset: vi.fn(),
  commit: vi.fn(),
  merge: vi.fn(),
  push: vi.fn(),
  pull: vi.fn(),
  fetch: vi.fn(),
  status: vi.fn(),
  diff: vi.fn(),
  show: vi.fn(),
  getAvailableBranches: vi.fn(),
}));
vi.mock('@/engine/cmd/terminalRegistry', () => ({
  terminalCommandRegistry: { getGitCommands: vi.fn(() => commands) },
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function run(args: string[]) {
  const output: string[] = [];
  await handleGitCommand(args, '/home/pyxis/workspace', emptyGitFilesystem(), async message => {
    output.push(String(message));
  });
  return output.join('\n');
}

function emptyGitFilesystem(): FsApi {
  return {
    stat: async path => {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
  } as FsApi;
}

function gitFilesystem(repositories: string[]): FsApi {
  return {
    stat: async path => {
      if (repositories.includes(path)) return { type: 'folder' };
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: 'ENOENT' });
    },
  } as FsApi;
}

function dispatchOptions(overrides: Partial<DispatchOptions> = {}): DispatchOptions {
  return {
    rootPath: '/home/pyxis/workspace',
    cwd: '/home/pyxis/workspace',
    fsClient: emptyGitFilesystem(),
    terminalColumns: 80,
    terminalRows: 24,
    trackDetachedProcess: () => {},
    getUnix: async () => null,
    setPwd: () => {},
    ...overrides,
  };
}

async function runThroughShell(args: string[], overrides: Partial<DispatchOptions> = {}) {
  const process = new Process();
  let stdout = '';
  let stderr = '';
  process.stdout.on('data', chunk => {
    stdout += String(chunk);
  });
  process.stderr.on('data', chunk => {
    stderr += String(chunk);
  });
  const code = await dispatchCommand('git', args, process, dispatchOptions(overrides));
  return { code, stdout, stderr };
}

describe('Terminal Git safety', () => {
  it('initializes at the current directory instead of the workspace root', async () => {
    commands.init.mockResolvedValue('initialized');

    const result = await runThroughShell(['init'], { cwd: '/home/pyxis/ui3-git' });

    expect(result).toEqual({ code: 0, stdout: 'initialized\n', stderr: '' });
    expect(commands.init).toHaveBeenCalledOnce();
    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
    expect(terminalCommandRegistry.getGitCommands).toHaveBeenCalledWith('/home/pyxis/ui3-git');
  });

  it('clones relative target directories from the current directory', async () => {
    commands.clone.mockResolvedValue('cloned');

    const result = await runThroughShell(
      ['clone', 'https://example.test/repository.git', 'checkout'],
      { cwd: '/home/pyxis/ui3-git' }
    );

    expect(result.stdout).toContain('cloned');
    expect(commands.clone).toHaveBeenCalledWith('https://example.test/repository.git', 'checkout');
    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
    expect(terminalCommandRegistry.getGitCommands).toHaveBeenCalledWith('/home/pyxis/ui3-git');
  });

  it('resolves nested add paths against the nearest repository root', async () => {
    commands.add.mockResolvedValue('added');
    const fsClient = gitFilesystem(['/home/pyxis/ui3-git/.git']);

    await runThroughShell(['add', 'src/file.ts'], {
      cwd: '/home/pyxis/ui3-git/packages/app',
      fsClient,
    });

    expect(commands.add).toHaveBeenCalledWith('packages/app/src/file.ts');
    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
    expect(terminalCommandRegistry.getGitCommands).toHaveBeenCalledWith('/home/pyxis/ui3-git');
  });

  it('resolves nested diff pathspecs from cwd and keeps branch arguments intact', async () => {
    commands.diff.mockResolvedValue('diff');
    commands.getAvailableBranches.mockResolvedValue({ local: ['main'], remote: [] });
    const options = {
      cwd: '/home/pyxis/ui3-git/packages/app',
      fsClient: gitFilesystem(['/home/pyxis/ui3-git/.git']),
    };

    await runThroughShell(['diff', 'src/file.ts'], options);
    expect(commands.diff).toHaveBeenLastCalledWith({ filepath: 'packages/app/src/file.ts' });

    await runThroughShell(['diff', '.'], options);
    expect(commands.diff).toHaveBeenLastCalledWith({ filepath: 'packages/app' });

    await runThroughShell(['diff', 'main'], options);
    expect(commands.diff).toHaveBeenLastCalledWith({ branchName: 'main' });

    await runThroughShell(['diff', 'HEAD', 'HEAD~1', 'src/file.ts'], options);
    expect(commands.diff).toHaveBeenLastCalledWith({
      commit1: 'HEAD',
      commit2: 'HEAD~1',
      filepath: 'packages/app/src/file.ts',
    });
  });

  it('resolves reset fallback and show commit paths from cwd while preserving refs', async () => {
    commands.reset.mockRejectedValueOnce(new Error('unknown revision'));
    commands.reset.mockResolvedValueOnce('unstaged');
    commands.show.mockResolvedValue('file content');
    const options = {
      cwd: '/home/pyxis/ui3-git/packages/app',
      fsClient: gitFilesystem(['/home/pyxis/ui3-git/.git']),
    };

    await runThroughShell(['reset', 'src/file.ts'], options);
    expect(commands.reset).toHaveBeenNthCalledWith(1, { commit: 'src/file.ts' });
    expect(commands.reset).toHaveBeenNthCalledWith(2, { filepath: 'packages/app/src/file.ts' });

    await runThroughShell(['show', 'HEAD:src/file.ts'], options);
    expect(commands.show).toHaveBeenCalledWith(['HEAD:packages/app/src/file.ts']);
  });

  it('keeps repositories isolated across workspace roots and outside the workspace', async () => {
    commands.status.mockResolvedValue('clean');
    const fsClient = gitFilesystem([
      '/home/pyxis/workspace-one/.git',
      '/home/pyxis/outside/repo/.git',
    ]);

    await runThroughShell(['status'], {
      cwd: '/home/pyxis/workspace-one/packages/app',
      fsClient,
    });
    await runThroughShell(['status'], {
      cwd: '/home/pyxis/outside/repo/tools',
      fsClient,
    });

    const { terminalCommandRegistry } = await import('@/engine/cmd/terminalRegistry');
    expect(terminalCommandRegistry.getGitCommands).toHaveBeenNthCalledWith(
      1,
      '/home/pyxis/workspace-one'
    );
    expect(terminalCommandRegistry.getGitCommands).toHaveBeenNthCalledWith(
      2,
      '/home/pyxis/outside/repo'
    );
  });

  it('preserves .git after cloning through the terminal', async () => {
    const core = new FsCore();
    await core.init(directoryTree());
    const dir = '/home/pyxis/workspace';
    await core.mkdir(dir, { recursive: true });
    const fs = createGitFs(core);
    const clone = new GitCloneOperations({ fs, dir });
    vi.spyOn(git, 'clone').mockImplementation(async options => {
      await git.init({ fs, dir: options.dir, defaultBranch: 'main' });
    });
    commands.clone.mockImplementation(clone.clone.bind(clone));
    await run(['clone', 'https://example.test/repository.git']);
    expect((await fs.promises.stat(`${dir}/repository/.git`)).isDirectory()).toBe(true);
  });

  it('passes --hard without an explicit commit to reset', async () => {
    commands.reset.mockResolvedValue('reset');
    await run(['reset', '--hard']);
    expect(commands.reset).toHaveBeenCalledWith({ hard: true, commit: undefined });
  });

  it('resolves existing remote refs while permitting local branch names with slashes', async () => {
    commands.checkoutRemote.mockResolvedValue('checked out');
    commands.getAvailableBranches.mockResolvedValue({
      local: ['feature/existing'],
      remote: ['origin/main'],
    });
    await run(['checkout', 'refs/remotes/origin/main']);
    expect(commands.checkoutRemote).toHaveBeenCalledWith('origin/main');
    await run(['checkout', 'origin/main']);
    expect(commands.checkoutRemote).toHaveBeenCalledWith('origin/main');
    await run(['checkout', 'feature/existing']);
    expect(commands.checkout).toHaveBeenCalledWith('feature/existing', false);
    await run(['checkout', '-b', 'feature/topic']);
    expect(commands.checkout).toHaveBeenCalledWith('feature/topic', true);
  });

  it('does not fetch or reset the worktree after pushing', async () => {
    commands.push.mockResolvedValue('To remote\n main -> main');
    await run(['push', 'upstream', 'main']);
    expect(commands.fetch).not.toHaveBeenCalled();
    expect(commands.reset).not.toHaveBeenCalled();
  });

  it('parses pull positionals and the supported rebase flag', async () => {
    commands.push.mockResolvedValue('pushed');
    commands.pull.mockResolvedValue('pulled');
    await run(['push', '--force', 'upstream', 'feature/topic']);
    expect(commands.push).toHaveBeenCalledWith({
      remote: 'upstream',
      branch: 'feature/topic',
      force: true,
    });
    await run(['pull', 'upstream', 'feature/topic']);
    expect(commands.pull).toHaveBeenCalledWith({
      remote: 'upstream',
      branch: 'feature/topic',
      rebase: false,
    });
  });

  it('rejects rebase and unknown pull flags through the terminal error channel', async () => {
    commands.pull.mockRejectedValue(
      new Error('git pull failed: git pull --rebase is not yet supported. Use merge instead.')
    );

    const rebaseResult = await runThroughShell(['pull', '--rebase']);
    expect(commands.pull).toHaveBeenCalledWith({
      remote: undefined,
      branch: undefined,
      rebase: true,
    });
    expect(rebaseResult).toEqual({
      code: 1,
      stdout: '',
      stderr: 'git: git pull failed: git pull --rebase is not yet supported. Use merge instead.\n',
    });

    const unknownFlagResult = await runThroughShell(['pull', '--verbose']);
    expect(commands.pull).toHaveBeenCalledTimes(1);
    expect(unknownFlagResult).toEqual({
      code: 1,
      stdout: '',
      stderr: "git: git pull: unknown option '--verbose'\n",
    });
  });

  it('rejects excess pull positionals', async () => {
    await expect(run(['pull', 'origin', 'main', 'extra'])).rejects.toThrow('too many arguments');
    expect(commands.pull).not.toHaveBeenCalled();
  });

  it('reports Git operation failures on stderr with a nonzero exit code', async () => {
    commands.status.mockRejectedValue(new Error('not a git repository'));

    const result = await runThroughShell(['status']);

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: 'git: git status: not a git repository\n',
    });
  });

  it('reports missing arguments on stderr with a nonzero exit code', async () => {
    const result = await runThroughShell(['commit']);

    expect(result).toEqual({
      code: 1,
      stdout: '',
      stderr: 'git: git commit: missing -m flag and message\n',
    });
  });

  it('preserves literal quotes in commit messages through shell dispatch', async () => {
    commands.commit.mockResolvedValue('committed');
    const message = `Keep 'single' and "double" quotes`;

    const result = await runThroughShell(['commit', '-m', message]);

    expect(result).toEqual({ code: 0, stdout: 'committed\n', stderr: '' });
    expect(commands.commit).toHaveBeenCalledWith(message);
  });

  it('rejects extra commit positionals and unsupported flags through shell dispatch', async () => {
    const extraArgument = await runThroughShell(['commit', '-m', 'message', 'extra']);
    const unknownOption = await runThroughShell(['commit', '-m', 'message', '--amend']);

    expect(extraArgument).toEqual({
      code: 1,
      stdout: '',
      stderr: "git: git commit: unexpected argument 'extra'. Usage: git commit -m <message>\n",
    });
    expect(unknownOption).toEqual({
      code: 1,
      stdout: '',
      stderr: "git: git commit: unknown option '--amend'\n",
    });
    expect(commands.commit).not.toHaveBeenCalled();
  });

  it('parses merge flags and branch independently and preserves quoted message text', async () => {
    commands.merge.mockResolvedValue('merged');
    const message = `Keep 'single' and "double" quotes`;

    const result = await runThroughShell(['merge', '--no-ff', 'feature/topic', '-m', message]);

    expect(result).toEqual({ code: 0, stdout: 'merged\n', stderr: '' });
    expect(commands.merge).toHaveBeenCalledWith('feature/topic', { noFf: true, message });
  });

  it('rejects unknown merge options and extra positional arguments', async () => {
    const unknownOption = await runThroughShell(['merge', '--verbose', 'feature/topic']);
    const extraArgument = await runThroughShell(['merge', 'feature/topic', 'other/topic']);

    expect(unknownOption).toEqual({
      code: 1,
      stdout: '',
      stderr: "git: git merge: unknown option '--verbose'\n",
    });
    expect(extraArgument).toEqual({
      code: 1,
      stdout: '',
      stderr:
        "git: git merge: unexpected argument 'other/topic'. Usage: git merge [--no-ff] [-m <message>] <branch>\n",
    });
    expect(commands.merge).not.toHaveBeenCalled();
  });
});
