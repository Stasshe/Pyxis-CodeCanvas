import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface GitCommands {
  add: (filepath: string) => Promise<string>;
  status: () => Promise<string>;
  branch: () => Promise<string>;
  listRemotes: () => Promise<string>;
  getAvailableBranches: () => Promise<{ local: string[]; remote: string[] }>;
  getFormattedLog: (
    depth: number,
    filter: { mode: 'auto' } | { mode: 'all'; branches?: string[] }
  ) => Promise<string>;
  diff: (options: { staged: boolean }) => Promise<string>;
}

type RefValue = object | boolean | number | null;

const mocks = vi.hoisted(() => ({
  refSlots: [] as Array<{ current: RefValue }>,
  refIndex: 0,
  cleanup: null as (() => void) | null,
  commandsByRoot: new Map<string, GitCommands>(),
}));

vi.mock('react', () => ({
  useCallback: <T>(callback: T) => callback,
  useEffect: (effect: () => (() => void) | undefined) => {
    const cleanup = effect();
    if (cleanup) mocks.cleanup = cleanup;
  },
  useMemo: <T>(factory: () => T) => factory(),
  useRef: <T extends RefValue>(current: T) => {
    const index = mocks.refIndex;
    mocks.refIndex += 1;
    let slot = mocks.refSlots[index];
    if (!slot) {
      slot = { current };
      mocks.refSlots.push(slot);
    }
    return slot as { current: T };
  },
  useState: <T>(initial: T | (() => T)) => {
    if (typeof initial === 'function') return [(initial as () => T)(), vi.fn()] as const;
    return [initial, vi.fn()] as const;
  },
}));

vi.mock('@/engine/system/terminal/terminalRegistry', () => ({
  terminalCommandRegistry: {
    getGitCommands: (rootPath: string) => mocks.commandsByRoot.get(rootPath) ?? null,
  },
}));

import { useGitPanel } from '@/hooks/git/useGitPanel';

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function createCommands(branchName: string) {
  return {
    add: vi.fn(async () => ''),
    status: vi.fn(async () => 'On branch main\nnothing to commit'),
    branch: vi.fn(async () => `* ${branchName}`),
    listRemotes: vi.fn(async () => ''),
    getAvailableBranches: vi.fn(async () => ({ local: [branchName], remote: [] })),
    getFormattedLog: vi.fn(async () => ''),
    diff: vi.fn(async () => 'diff'),
  };
}

function renderPanel(currentProject: string, rootPath: string, onStatusChange?: () => void) {
  mocks.refIndex = 0;
  return useGitPanel({ currentProject, rootPath, onGitStatusChange: onStatusChange });
}

describe('useGitPanel refresh queue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal('sessionStorage', { getItem: vi.fn(() => null) });
    mocks.refSlots = [];
    mocks.refIndex = 0;
    mocks.cleanup = null;
    mocks.commandsByRoot.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('runs one trailing refresh with the latest depth and branch filter', async () => {
    const firstStatus = deferred<string>();
    const commands = createCommands('main');
    commands.status.mockReturnValueOnce(firstStatus.promise);
    mocks.commandsByRoot.set('/home/pyxis/demo', commands);
    const onStatusChange = vi.fn();
    const panel = renderPanel('demo', '/home/pyxis/demo', onStatusChange);

    const initialRefresh = panel.fetchGitStatus(20, 'auto', []);
    const supersededRefresh = panel.fetchGitStatus(30, 'all', ['feature']);
    const latestRefresh = panel.fetchGitStatus(40, 'all', ['release']);

    firstStatus.resolve('On branch main\nnothing to commit');
    await Promise.all([initialRefresh, supersededRefresh, latestRefresh]);

    expect(commands.status).toHaveBeenCalledTimes(2);
    expect(commands.getFormattedLog).toHaveBeenNthCalledWith(1, 20, { mode: 'auto' });
    expect(commands.getFormattedLog).toHaveBeenNthCalledWith(2, 40, {
      mode: 'all',
      branches: ['release'],
    });
    expect(onStatusChange).toHaveBeenCalledOnce();
  });

  it('does not apply an older workspace response after switching roots', async () => {
    const oldStatus = deferred<string>();
    const oldCommands = createCommands('old');
    const newCommands = createCommands('new');
    oldCommands.status.mockReturnValueOnce(oldStatus.promise);
    mocks.commandsByRoot.set('/workspace/old', oldCommands);
    mocks.commandsByRoot.set('/workspace/new', newCommands);
    const oldStatusChange = vi.fn();
    const newStatusChange = vi.fn();

    const oldPanel = renderPanel('old', '/workspace/old', oldStatusChange);
    const oldRefresh = oldPanel.fetchGitStatus(20);
    const newPanel = renderPanel('new', '/workspace/new', newStatusChange);
    const newRefresh = newPanel.fetchGitStatus(20);

    oldStatus.resolve('On branch main\nnothing to commit');
    await Promise.all([oldRefresh, newRefresh]);

    expect(oldStatusChange).not.toHaveBeenCalled();
    expect(newStatusChange).toHaveBeenCalledOnce();
    expect(newCommands.status).toHaveBeenCalledOnce();
  });

  it('does not apply a pending response after unmount', async () => {
    const status = deferred<string>();
    const commands = createCommands('main');
    commands.status.mockReturnValueOnce(status.promise);
    mocks.commandsByRoot.set('/workspace/main', commands);
    const onStatusChange = vi.fn();
    const panel = renderPanel('main', '/workspace/main', onStatusChange);
    const refresh = panel.fetchGitStatus(20);

    mocks.cleanup?.();
    status.resolve('On branch main\nnothing to commit');
    await refresh;

    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it('does not return a diff response after switching workspaces', async () => {
    const oldDiff = deferred<string>();
    const oldCommands = createCommands('old');
    const newCommands = createCommands('new');
    oldCommands.diff.mockReturnValueOnce(oldDiff.promise);
    mocks.commandsByRoot.set('/workspace/old', oldCommands);
    mocks.commandsByRoot.set('/workspace/new', newCommands);

    const oldPanel = renderPanel('old', '/workspace/old');
    const pendingDiff = oldPanel.getDiff();
    renderPanel('new', '/workspace/new');
    oldDiff.resolve('old workspace diff');

    await expect(pendingDiff).resolves.toBe('');
  });

  it('waits for the filesystem refresh after staging', async () => {
    const commands = createCommands('main');
    mocks.commandsByRoot.set('/workspace/main', commands);
    const panel = renderPanel('main', '/workspace/main');

    await panel.stageFile('/workspace/main/README.md');

    expect(commands.add).toHaveBeenCalledOnce();
    expect(commands.status).not.toHaveBeenCalled();
  });
});
