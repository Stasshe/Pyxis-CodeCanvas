import { useCallback } from 'react';

import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { basename, fsClient, normalizePath, posixPath, resolvePath } from '@/engine/core/fs';
import { tabActions } from '@/stores/tabState';
import type { Project, SingleFileDiff } from '@/types';

interface WorkingFile {
  content?: string;
  bufferContent?: ArrayBuffer;
}

function absolutePath(rootPath: string, path: string): string {
  if (path.startsWith('/')) return normalizePath(path);
  return resolvePath(rootPath, path);
}

function gitPath(rootPath: string, path: string): string {
  return posixPath.relative(rootPath, absolutePath(rootPath, path));
}

async function readWorkingFile(path: string): Promise<WorkingFile | null> {
  if (!(await fsClient.exists(path))) return null;
  const entry = await fsClient.stat(path);
  if (entry.type !== 'file') return null;

  const bytes = await fsClient.readFile(path);
  try {
    const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (content.includes('\0')) return { bufferContent: Uint8Array.from(bytes).buffer };
    return { content };
  } catch {
    return { bufferContent: Uint8Array.from(bytes).buffer };
  }
}

async function openBinaryFile(path: string, bufferContent: ArrayBuffer): Promise<void> {
  await tabActions.openTab(
    {
      path,
      name: basename(path),
      isBufferArray: true,
      bufferContent,
    },
    { kind: 'binary', searchAllPanesForReuse: true }
  );
}

function singleFileDiff(
  path: string,
  formerCommitId: string,
  latterCommitId: string,
  formerContent: string,
  latterContent: string
): SingleFileDiff {
  return {
    formerFullPath: path,
    formerCommitId,
    latterFullPath: path,
    latterCommitId,
    formerContent,
    latterContent,
  };
}

export function useDiffTabHandlers(currentProject: Project | null) {
  const handleStagedFileDiff = useCallback(
    async (filePath: string) => {
      if (!currentProject) return;

      const { rootPath } = currentProject;
      const path = absolutePath(rootPath, filePath);
      const relativePath = gitPath(rootPath, path);
      const workingFile = await readWorkingFile(path);
      if (workingFile?.bufferContent) {
        await openBinaryFile(path, workingFile.bufferContent);
        return;
      }

      const git = terminalCommandRegistry.getGitCommands(rootPath);
      let headContent = '';
      let stagedContent = '';
      try {
        headContent = (await git.getHeadFileContent(relativePath)) || '';
      } catch (error) {
        console.warn('[useDiffTabHandlers] Failed to get HEAD content:', error);
      }
      try {
        stagedContent = (await git.getStagedFileContent(relativePath)) || '';
      } catch (error) {
        console.warn('[useDiffTabHandlers] Failed to get staged content:', error);
      }

      await tabActions.openTab(
        {
          files: singleFileDiff(path, 'HEAD', 'INDEX', headContent, stagedContent),
          editable: false,
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject]
  );

  const handleUnstagedFileDiff = useCallback(
    async (filePath: string, stagedFiles: string[] = []) => {
      if (!currentProject) return;

      const { rootPath } = currentProject;
      const path = absolutePath(rootPath, filePath);
      const relativePath = gitPath(rootPath, path);
      const isAlsoStaged = stagedFiles.some(
        stagedPath => gitPath(rootPath, stagedPath) === relativePath
      );
      const git = terminalCommandRegistry.getGitCommands(rootPath);

      let formerContent = '';
      let formerCommitId = 'HEAD';
      if (isAlsoStaged) {
        try {
          formerContent = (await git.getStagedFileContent(relativePath)) || '';
          formerCommitId = 'INDEX';
        } catch (error) {
          console.warn('[useDiffTabHandlers] Failed to get staged content:', error);
          try {
            formerContent = (await git.getHeadFileContent(relativePath)) || '';
          } catch (headError) {
            console.warn('[useDiffTabHandlers] Failed to get HEAD content:', headError);
          }
        }
      } else {
        try {
          formerContent = (await git.getHeadFileContent(relativePath)) || '';
        } catch (error) {
          console.warn('[useDiffTabHandlers] Failed to get HEAD content:', error);
        }
      }

      const workingFile = await readWorkingFile(path);
      if (workingFile?.bufferContent) {
        await openBinaryFile(path, workingFile.bufferContent);
        return;
      }

      await tabActions.openTab(
        {
          files: singleFileDiff(
            path,
            formerCommitId,
            'WORKDIR',
            formerContent,
            workingFile?.content || ''
          ),
          editable: true,
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject]
  );

  const handleCommitsDiff = useCallback(
    async ({ commitId, filePath }: { commitId: string; filePath: string }) => {
      if (!currentProject) return;

      const { rootPath } = currentProject;
      const path = absolutePath(rootPath, filePath);
      const relativePath = gitPath(rootPath, path);
      const git = terminalCommandRegistry.getGitCommands(rootPath);
      const parentHashes = await git.getParentCommitIds(commitId);
      const parentCommitId = parentHashes[0] || '';

      let latterContent = '';
      let formerContent = '';
      try {
        if (commitId) latterContent = await git.getFileContentAtCommit(commitId, relativePath);
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get latter content:', error);
      }
      try {
        if (parentCommitId) {
          formerContent = await git.getFileContentAtCommit(parentCommitId, relativePath);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get former content:', error);
      }

      if (!formerContent && !latterContent) {
        const workingFile = await readWorkingFile(path);
        if (workingFile?.bufferContent) {
          await openBinaryFile(path, workingFile.bufferContent);
        }
        return;
      }

      await tabActions.openTab(
        {
          files: singleFileDiff(path, parentCommitId, commitId, formerContent, latterContent),
          editable: false,
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject]
  );

  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const { rootPath } = currentProject;
      const git = terminalCommandRegistry.getGitCommands(rootPath);
      let resolvedParentId = parentCommitId;
      if (!resolvedParentId) {
        try {
          resolvedParentId = (await git.getParentCommitIds(commitId))[0] || '';
        } catch (error) {
          console.warn('[useDiffTabHandlers] Failed to resolve parent commit:', error);
        }
      }

      const diffOutput = await git.diffCommits(resolvedParentId, commitId);
      const files: Array<{ gitPath: string; path: string }> = [];
      for (const line of diffOutput.split('\n')) {
        if (!line.startsWith('diff --git ')) continue;
        const match = line.match(/diff --git a\/(.+) b\/(.+)/);
        if (!match) continue;
        const relativePath = match[2];
        files.push({ gitPath: relativePath, path: resolvePath(rootPath, relativePath) });
      }

      const diffs: SingleFileDiff[] = [];
      for (const file of files) {
        let latterContent = '';
        let formerContent = '';
        try {
          if (commitId) latterContent = await git.getFileContentAtCommit(commitId, file.gitPath);
        } catch (error) {
          console.warn('[useDiffTabHandlers] Failed to read latter content:', error);
        }
        try {
          if (resolvedParentId) {
            formerContent = await git.getFileContentAtCommit(resolvedParentId, file.gitPath);
          }
        } catch (error) {
          console.warn('[useDiffTabHandlers] Failed to read former content:', error);
        }
        diffs.push(
          singleFileDiff(file.path, resolvedParentId, commitId, formerContent, latterContent)
        );
      }

      await tabActions.openTab(
        { files: diffs, editable: false, isMultiFile: true },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject]
  );

  return {
    handleCommitsDiff,
    handleDiffAllFilesClick,
    handleStagedFileDiff,
    handleUnstagedFileDiff,
  };
}
