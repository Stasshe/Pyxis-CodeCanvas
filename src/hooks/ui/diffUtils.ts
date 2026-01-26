// Utils for reconstructing file contents from diffs and reading working tree

// Apply unified diff (git -U) to old content and reconstruct the new content for a target path
export function applyUnifiedDiffToContent(oldContent: string, diffText: string, targetGitPath: string) {
  if (!diffText) return '';
  const lines = diffText.split('\n');

  // find the starting diff block for the target path
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('diff --git')) {
      const m = l.match(/diff --git a\/(.+) b\/(.+)/);
      if (m && m[2] === targetGitPath) {
        start = i;
        break;
      }
    }
  }
  const block = start >= 0 ? lines.slice(start) : lines;

  // extract hunks
  const hunks: Array<{ origStart: number; origCount: number; lines: string[] }> = [];
  let i = 0;
  while (i < block.length) {
    const l = block[i];
    if (l.startsWith('@@')) {
      const header = l;
      const match = header.match(/@@ -([0-9]+),?([0-9]*) \+([0-9]+),?([0-9]*) @@/);
      if (match) {
        const origStart = Number(match[1]);
        const origCount = match[2] ? Number(match[2]) : 1;
        i++;
        const hlines: string[] = [];
        while (i < block.length && !block[i].startsWith('@@') && !block[i].startsWith('diff --git')) {
          hlines.push(block[i]);
          i++;
        }
        hunks.push({ origStart, origCount, lines: hlines });
        continue;
      }
    }
    i++;
  }

  const oldLines = oldContent === '' ? [] : oldContent.split('\n');
  const resultLines: string[] = [];
  let posOrig = 0; // 0-based index into oldLines

  for (const hunk of hunks) {
    const hStartIndex = hunk.origStart - 1; // convert to 0-based
    // unchanged lines before hunk
    while (posOrig < hStartIndex && posOrig < oldLines.length) {
      resultLines.push(oldLines[posOrig]);
      posOrig++;
    }

    // process hunk lines
    let readOrigIndex = hStartIndex;
    for (const hl of hunk.lines) {
      if (hl.startsWith(' ')) {
        // context line
        resultLines.push(oldLines[readOrigIndex] ?? '');
        readOrigIndex++;
      } else if (hl.startsWith('-')) {
        // deletion
        readOrigIndex++;
      } else if (hl.startsWith('+')) {
        // addition
        resultLines.push(hl.substring(1));
      } else {
        // treat as context
        resultLines.push(hl);
        readOrigIndex++;
      }
    }

    posOrig = hStartIndex + hunk.origCount;
  }

  // append remaining original lines
  while (posOrig < oldLines.length) {
    resultLines.push(oldLines[posOrig]);
    posOrig++;
  }

  // Trim trailing newlines that can be introduced during hunk parsing
  return resultLines.join('\n').replace(/\n+$/g, '');
}

// Helper: get workdir content (fileRepository -> fallback gitFileSystem)
export async function getWorkdirContent(currentProject: any, normalizedPath: string, gitPath: string) {
  let content = '';
  try {
    const { fileRepository } = await import('@/engine/core/fileRepository');
    const file = await fileRepository.getFileByPath(currentProject.id, normalizedPath);
    if (file?.content) {
      content = file.content;
    }
  } catch (repoErr) {
    try {
      const { gitFileSystem } = await import('@/engine/core/gitFileSystem');
      content = await gitFileSystem.readFile(currentProject.name, gitPath);
    } catch (fsErr) {
      content = '';
    }
  }
  return content;
}

// Helper: get commit content safely
export async function getCommitContent(git: any, commitId: string, gitPath: string) {
  if (!commitId) return '';
  try {
    return await git.getFileContentAtCommit(commitId, gitPath);
  } catch (e) {
    return '';
  }
}

// Helper: reconstruct staged content by applying staged unified diff to HEAD content
export async function getStagedContent(git: any, headCommitId: string, gitPath: string) {
  try {
    const headContent = await getCommitContent(git, headCommitId, gitPath);
    let stagedDiffText = '';
    try {
      stagedDiffText = await git.diff({ staged: true, filepath: gitPath });
    } catch (e) {
      stagedDiffText = '';
    }

    let stagedContent = applyUnifiedDiffToContent(headContent, stagedDiffText, gitPath);

    // Fallback: if HEAD empty and diff exists, try to build from + lines
    if ((!stagedContent || stagedContent === '') && stagedDiffText && headContent === '') {
      const plusLines: string[] = [];
      for (const line of stagedDiffText.split('\n')) {
        if (line.startsWith('+') && !line.startsWith('+++ ')) plusLines.push(line.substring(1));
      }
      stagedContent = plusLines.join('\n');
    }

    return stagedContent;
  } catch (e) {
    return '';
  }
}
