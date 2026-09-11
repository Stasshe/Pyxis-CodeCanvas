import { beforeEach, describe, expect, it, vi } from 'vitest';

const gitMocks = vi.hoisted(() => {
  class NotFoundError extends Error {
    code = 'NotFoundError' as const;
    data: { what: string };

    constructor(what: string) {
      super(`Could not find ${what}.`);
      this.data = { what };
    }
  }

  return {
    NotFoundError,
    listBranches: vi.fn(),
    log: vi.fn(),
  };
});

vi.mock('isomorphic-git', () => ({
  default: {
    Errors: { NotFoundError: gitMocks.NotFoundError },
    listBranches: gitMocks.listBranches,
    log: gitMocks.log,
  },
}));

vi.mock('@/engine/cmd/global/gitOperations/fileSystemHelper', () => ({
  GitFileSystemHelper: {
    ensureDirectory: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('@/engine/cmd/global/gitOperations/remoteUtils', () => ({
  listAllRemoteRefs: vi.fn().mockResolvedValue([]),
  toFullRemoteRef: (ref: string) => ref,
}));

import { GitLogOperations } from '@/engine/cmd/global/gitOperations/log';

const fs = {
  promises: {
    stat: vi.fn().mockResolvedValue({}),
  },
};

describe('GitLogOperations', () => {
  beforeEach(() => {
    gitMocks.listBranches.mockReset().mockResolvedValue([]);
    gitMocks.log.mockReset().mockRejectedValue(new gitMocks.NotFoundError('refs/heads/main'));
  });

  it('reports no commits for an unborn branch', async () => {
    const operations = new GitLogOperations(fs as never, '/projects/example');

    await expect(operations.log()).resolves.toBe('No commits yet');
  });

  it('returns an empty formatted history for an unborn branch', async () => {
    const operations = new GitLogOperations(fs as never, '/projects/example');

    await expect(operations.getFormattedLog()).resolves.toBe('');
  });

  it('does not hide unrelated missing Git data', async () => {
    gitMocks.log.mockRejectedValue(new gitMocks.NotFoundError('object deadbeef'));
    const operations = new GitLogOperations(fs as never, '/projects/example');

    await expect(operations.getFormattedLog()).rejects.toThrow(
      'git log failed: Could not find object deadbeef.'
    );
  });
});
