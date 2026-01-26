'use client';

import type { GitCommit as GitCommitType, GitStatus } from '@/types/git';

// Git logをパースしてコミット配列に変換（ブランチ情報付き）
export function parseGitLog(logOutput: string): GitCommitType[] {
  if (!logOutput.trim()) {
    return [];
  }

  const lines = logOutput.split('\n').filter(line => line.trim());
  const commits: GitCommitType[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const parts = line.split('|');

    // 7つのパーツがあることを確認（refs + tree情報を含む）
    if (parts.length === 7) {
      const hash = parts[0]?.trim();
      const message = parts[1]?.trim();
      const author = parts[2]?.trim();
      const date = parts[3]?.trim();
      const parentHashesStr = parts[4]?.trim();
      const refsStr = parts[5]?.trim();
      const treeSha = parts[6]?.trim();

      if (hash && hash.length >= 7 && message && author && date) {
        try {
          const timestamp = new Date(date).getTime();
          if (!Number.isNaN(timestamp)) {
            const parentHashes =
              parentHashesStr && parentHashesStr !== ''
                ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                : [];

            const refs =
              refsStr && refsStr !== '' ? refsStr.split(',').filter(r => r.trim() !== '') : [];

            commits.push({
              hash,
              shortHash: hash.substring(0, 7),
              message: message.replace(/｜/g, '|'),
              author: author.replace(/｜/g, '|'),
              date,
              timestamp,
              isMerge: parentHashes.length > 1,
              parentHashes,
              refs,
              tree: treeSha || undefined,
            });
          }
        } catch {
          // Date parsing error, skip this commit
        }
      }
    } else if (parts.length === 6) {
      const hash = parts[0]?.trim();
      const message = parts[1]?.trim();
      const author = parts[2]?.trim();
      const date = parts[3]?.trim();
      const parentHashesStr = parts[4]?.trim();
      const refsStr = parts[5]?.trim();

      if (hash && hash.length >= 7 && message && author && date) {
        try {
          const timestamp = new Date(date).getTime();
          if (!Number.isNaN(timestamp)) {
            const parentHashes =
              parentHashesStr && parentHashesStr !== ''
                ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                : [];

            const refs =
              refsStr && refsStr !== '' ? refsStr.split(',').filter(r => r.trim() !== '') : [];

            commits.push({
              hash,
              shortHash: hash.substring(0, 7),
              message: message.replace(/｜/g, '|'),
              author: author.replace(/｜/g, '|'),
              date,
              timestamp,
              isMerge: parentHashes.length > 1,
              parentHashes,
              refs,
              tree: undefined,
            });
          }
        } catch {
          // Date parsing error, skip this commit
        }
      }
    } else if (parts.length === 5) {
      const hash = parts[0]?.trim();
      const message = parts[1]?.trim();
      const author = parts[2]?.trim();
      const date = parts[3]?.trim();
      const parentHashesStr = parts[4]?.trim();

      if (hash && hash.length >= 7 && message && author && date) {
        try {
          const timestamp = new Date(date).getTime();
          if (!Number.isNaN(timestamp)) {
            const parentHashes =
              parentHashesStr && parentHashesStr !== ''
                ? parentHashesStr.split(',').filter(h => h.trim() !== '')
                : [];

            commits.push({
              hash,
              shortHash: hash.substring(0, 7),
              message: message.replace(/｜/g, '|'),
              author: author.replace(/｜/g, '|'),
              date,
              timestamp,
              isMerge: parentHashes.length > 1,
              parentHashes,
              refs: [],
            });
          }
        } catch {
          // Date parsing error, skip this commit
        }
      }
    }
  }

  return commits.sort((a, b) => b.timestamp - a.timestamp);
}

export function parseGitBranches(branchOutput: string) {
  return branchOutput
    .split('\n')
    .filter(line => line.trim())
    .map(line => ({
      name: line.replace(/^\*\s*/, '').trim(),
      isCurrent: line.startsWith('*'),
      isRemote: line.includes('remotes/'),
      lastCommit: undefined,
    }));
}

export function parseGitStatus(statusOutput: string): GitStatus {
  const lines = statusOutput.split('\n');
  const status: GitStatus = {
    staged: [],
    unstaged: [],
    untracked: [],
    deleted: [],
    branch: 'main',
    ahead: 0,
    behind: 0,
  };

  let inChangesToBeCommitted = false;
  let inChangesNotStaged = false;
  let inUntrackedFiles = false;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.includes('On branch')) {
      status.branch = trimmed.replace('On branch ', '').trim();
    } else if (trimmed === 'Changes to be committed:') {
      inChangesToBeCommitted = true;
      inChangesNotStaged = false;
      inUntrackedFiles = false;
    } else if (trimmed === 'Changes not staged for commit:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = true;
      inUntrackedFiles = false;
    } else if (trimmed === 'Untracked files:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = false;
      inUntrackedFiles = true;
    } else if (
      trimmed.startsWith('modified:') ||
      trimmed.startsWith('new file:') ||
      trimmed.startsWith('deleted:')
    ) {
      const fileName = trimmed.split(':')[1]?.trim();
      if (fileName) {
        if (inChangesToBeCommitted) {
          status.staged.push(fileName);
        } else if (inChangesNotStaged) {
          if (trimmed.startsWith('deleted:')) {
            status.deleted.push(fileName);
          } else {
            status.unstaged.push(fileName);
          }
        }
      }
    } else if (
      inUntrackedFiles &&
      trimmed &&
      !trimmed.startsWith('(') &&
      !trimmed.includes('git add') &&
      !trimmed.includes('use "git add"') &&
      !trimmed.includes('to include')
    ) {
      if (!trimmed.endsWith('/')) {
        status.untracked.push(trimmed);
      }
    }
  }

  return status;
}
