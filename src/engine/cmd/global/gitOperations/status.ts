// src/engine/cmd/global/gitOperations/status.ts

export function categorizeStatusFiles(
  status: Array<[string, number, number, number]>
): {
  untracked: string[];
  modified: string[];
  staged: string[];
  deleted: string[];
} {
  const untracked: string[] = [];
  const modified: string[] = [];
  const staged: string[] = [];
  const deleted: string[] = [];

  console.log('[categorizeStatusFiles] Processing', status.length, 'files');

  for (let i = 0; i < status.length; i++) {
    const [filepath, HEAD, workdir, stage] = status[i];

    if (HEAD === 0 && (workdir === 1 || workdir === 2) && stage === 0) {
      untracked.push(filepath);
      console.log('[categorizeStatusFiles]  -> untracked');
    } else if (HEAD === 0 && stage === 3) {
      staged.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged (new, stage=3)');
    } else if (HEAD === 0 && stage === 2) {
      staged.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged (new, stage=2)');
    } else if (HEAD === 1 && workdir === 2 && stage === 1) {
      modified.push(filepath);
      console.log('[categorizeStatusFiles]  -> modified (unstaged)');
    } else if (HEAD === 1 && workdir === 2 && stage === 2) {
      staged.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged (modified)');
    } else if (HEAD === 1 && workdir === 2 && stage === 3) {
      staged.push(filepath);
      modified.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged + modified (staged file was modified)');
    } else if (HEAD === 1 && workdir === 1 && stage === 3) {
      staged.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged (stage=3, workdir unchanged)');
    } else if (HEAD === 1 && workdir === 0 && stage === 1) {
      deleted.push(filepath);
      console.log('[categorizeStatusFiles]  -> deleted (unstaged)');
    } else if (HEAD === 1 && workdir === 0 && stage === 0) {
      staged.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged (deleted)');
    } else if (HEAD === 1 && workdir === 0 && stage === 3) {
      staged.push(filepath);
      console.log('[categorizeStatusFiles]  -> staged (deleted, stage=3)');
    } else {
      console.log('[categorizeStatusFiles]  -> no change or unhandled case');
    }
  }

  console.log('[categorizeStatusFiles] Result:', {
    untracked: untracked.length,
    modified: modified.length,
    staged: staged.length,
    deleted: deleted.length,
  });

  return { untracked, modified, staged, deleted };
}

export async function formatStatusResult(
  status: Array<[string, number, number, number]>,
  currentBranch: string
): Promise<string> {
  if (status.length === 0) {
    return `On branch ${currentBranch}\nnothing to commit, working tree clean`;
  }

  const { untracked, modified, staged, deleted } = categorizeStatusFiles(status);

  let result = `On branch ${currentBranch}\n`;

  if (staged.length > 0) {
    result += '\nChanges to be committed:\n';
    for (let i = 0; i < staged.length; i++) {
      const file = staged[i];
      result += `  new file:   ${file}\n`;
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
    result += '\nnothing added to commit but untracked files present (use "git add" to track)';
  }

  if (
    staged.length === 0 &&
    modified.length === 0 &&
    untracked.length === 0 &&
    deleted.length === 0
  ) {
    result = `On branch ${currentBranch}\nnothing to commit, working tree clean`;
  }

  return result;
}
