export function categorizeStatusFiles(status: Array<[string, number, number, number]>): {
  untracked: string[];
  modified: string[];
  stagedAdded: string[];
  stagedModified: string[];
  stagedDeleted: string[];
  deleted: string[];
} {
  const untracked: string[] = [];
  const modified: string[] = [];
  const stagedAdded: string[] = [];
  const stagedModified: string[] = [];
  const stagedDeleted: string[] = [];
  const deleted: string[] = [];

  for (const [filepath, head, workdir, stage] of status) {
    if (head !== stage) {
      if (head === 0) stagedAdded.push(filepath);
      else if (stage === 0) stagedDeleted.push(filepath);
      else stagedModified.push(filepath);
    }

    if (workdir === stage) continue;
    if (workdir === 0) deleted.push(filepath);
    else if (stage === 0) untracked.push(filepath);
    else modified.push(filepath);
  }

  return { untracked, modified, stagedAdded, stagedModified, stagedDeleted, deleted };
}

export async function formatStatusResult(
  status: Array<[string, number, number, number]>,
  currentBranch: string
): Promise<string> {
  if (status.length === 0) {
    return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
  }

  const { untracked, modified, stagedAdded, stagedModified, stagedDeleted, deleted } =
    categorizeStatusFiles(status);
  const hasStagedChanges =
    stagedAdded.length > 0 || stagedModified.length > 0 || stagedDeleted.length > 0;

  let result = `On branch ${currentBranch}\n`;

  if (hasStagedChanges) {
    result += '\nChanges to be committed:\n';
    for (const file of stagedAdded) {
      result += `  new file:   ${file}\n`;
    }
    for (const file of stagedModified) {
      result += `  modified:   ${file}\n`;
    }
    for (const file of stagedDeleted) {
      result += `  deleted:    ${file}\n`;
    }
  }

  if (modified.length > 0) {
    result += '\nChanges not staged for commit:\n';
    for (let i = 0; i < modified.length; i++) {
      const file = modified[i];
      result += `  modified:   ${file}\n`;
    }
  }

  if (deleted.length > 0) {
    if (modified.length === 0) {
      result += '\nChanges not staged for commit:\n';
    }
    for (let i = 0; i < deleted.length; i++) {
      result += `  deleted:    ${deleted[i]}\n`;
    }
  }

  if (untracked.length > 0) {
    result += '\nUntracked files:\n';
    for (let i = 0; i < untracked.length; i++) {
      result += `  ${untracked[i]}\n`;
    }
    if (!hasStagedChanges) {
      result += '\nnothing added to commit but untracked files present (use "git add" to track)';
    }
  }

  if (
    !hasStagedChanges &&
    modified.length === 0 &&
    untracked.length === 0 &&
    deleted.length === 0
  ) {
    result = `On branch ${currentBranch}\nnothing to commit, working tree clean`;
  }

  return result;
}
