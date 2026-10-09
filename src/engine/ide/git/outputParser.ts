import type { GitCommit as GitCommitType, GitStatus } from '@/types/git';

// Git logをパースしてコミット配列に変換（ブランチ情報付き）
export function parseGitLog(logOutput: string): GitCommitType[] {
  const commits: GitCommitType[] = [];

  for (const line of logOutput.split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('|');
    if (parts.length !== 7) continue;
    const hash = parts[0]?.trim();
    const message = parts[1]?.trim() ?? '';
    const author = parts[2]?.trim();
    const date = parts[3]?.trim();
    const parentHashes = parts[4]?.trim().split(',').filter(Boolean) ?? [];
    const refs = parts[5]?.trim().split(',').filter(Boolean) ?? [];
    const treeSha = parts[6]?.trim();
    if (!hash || hash.length < 7 || !author || !date) continue;

    const timestamp = new Date(date).getTime();
    if (Number.isNaN(timestamp)) continue;

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

    if (!line.startsWith('  ') && trimmed.startsWith('On branch ')) {
      status.branch = trimmed.replace('On branch ', '').trim();
    } else if (!line.startsWith('  ') && trimmed === 'Changes to be committed:') {
      inChangesToBeCommitted = true;
      inChangesNotStaged = false;
      inUntrackedFiles = false;
    } else if (!line.startsWith('  ') && trimmed === 'Changes not staged for commit:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = true;
      inUntrackedFiles = false;
    } else if (!line.startsWith('  ') && trimmed === 'Untracked files:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = false;
      inUntrackedFiles = true;
    } else if (!inUntrackedFiles && /^(modified|new file|deleted):\s*/.test(trimmed)) {
      const separatorIndex = trimmed.indexOf(':');
      const changeType = trimmed.slice(0, separatorIndex);
      const fileName = trimmed.slice(separatorIndex + 1).trim();
      if (fileName) {
        if (inChangesToBeCommitted) {
          status.staged.push(fileName);
        } else if (inChangesNotStaged) {
          if (changeType === 'deleted') {
            status.deleted.push(fileName);
          } else {
            status.unstaged.push(fileName);
          }
        }
      }
    } else if (inUntrackedFiles && trimmed && line.startsWith('  ')) {
      if (!trimmed.endsWith('/')) {
        status.untracked.push(trimmed);
      }
    }
  }

  return status;
}
