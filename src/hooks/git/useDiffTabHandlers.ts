import { useCallback } from 'react';
import { detectFileContent, type FileContent } from '@/engine/core/fileBytes';
import { basename, fsClient, normalizePath, posixPath, resolvePath } from '@/engine/core/fs/index';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { tabActions } from '@/stores/tabState';
import type { Project, SingleFileDiff } from '@/types/index';

function absolutePath(rootPath: string, path: string): string {
  if (path.startsWith('/')) return normalizePath(path);
  return resolvePath(rootPath, path);
}

function gitPath(rootPath: string, path: string): string {
  return posixPath.relative(rootPath, absolutePath(rootPath, path));
}

async function readWorkingFile(path: string): Promise<FileContent | null> {
  if (!(await fsClient.exists(path))) return null;
  const entry = await fsClient.stat(path);
  if (entry.type !== 'file') return null;
  return detectFileContent(path, await fsClient.readFile(path));
}

async function gitContent(path: string, bytes: Uint8Array | null): Promise<FileContent> {
  if (bytes === null) return { kind: 'text', content: '' };
  return detectFileContent(path, bytes);
}

async function openBinaryFile(path: string, file: FileContent, version: string): Promise<boolean> {
  if (file.kind !== 'binary') return false;
  await tabActions.openTab(
    {
      path: `${path}#${version}`,
      name: `${basename(path)} (${version})`,
      isBufferArray: true,
      bufferContent: file.bufferContent,
      mimeType: file.mimeType,
      isSnapshot: true,
    },
    { kind: 'binary', searchAllPanesForReuse: true }
  );
  return true;
}

async function openDiff(
  path: string,
  formerId: string,
  latterId: string,
  former: FileContent,
  latter: FileContent,
  editable: boolean
): Promise<void> {
  if (former.kind === 'binary' || latter.kind === 'binary') {
    await openBinaryFile(path, former, formerId);
    await openBinaryFile(path, latter, latterId);
    return;
  }
  await tabActions.openTab(
    { files: singleFileDiff(path, formerId, latterId, former.content, latter.content), editable },
    { kind: 'diff', searchAllPanesForReuse: true }
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
      const git = terminalCommandRegistry.getGitCommands(rootPath);
      const former = await gitContent(path, await git.getHeadFileContent(relativePath));
      const latter = await gitContent(path, await git.getStagedFileContent(relativePath));
      await openDiff(path, 'HEAD', 'INDEX', former, latter, false);
    },
    [currentProject]
  );

  const handleUnstagedFileDiff = useCallback(
    async (filePath: string, stagedFiles: string[] = []) => {
      if (!currentProject) return;
      const { rootPath } = currentProject;
      const path = absolutePath(rootPath, filePath);
      const relativePath = gitPath(rootPath, path);
      const git = terminalCommandRegistry.getGitCommands(rootPath);
      let formerId = 'HEAD';
      let bytes = await git.getHeadFileContent(relativePath);
      if (stagedFiles.some(staged => gitPath(rootPath, staged) === relativePath)) {
        formerId = 'INDEX';
        bytes = await git.getStagedFileContent(relativePath);
      }
      const former = await gitContent(path, bytes);
      const latter = (await readWorkingFile(path)) ?? { kind: 'text', content: '' };
      await openDiff(path, formerId, 'WORKDIR', former, latter, true);
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
      const parentId = (await git.getParentCommitIds(commitId))[0] ?? '';
      const latter = await gitContent(
        path,
        await git.getFileContentAtCommit(commitId, relativePath)
      );
      let former: FileContent = { kind: 'text', content: '' };
      if (parentId)
        former = await gitContent(path, await git.getFileContentAtCommit(parentId, relativePath));
      await openDiff(path, parentId, commitId, former, latter, false);
    },
    [currentProject]
  );

  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const { rootPath } = currentProject;
      const git = terminalCommandRegistry.getGitCommands(rootPath);
      let parentId = parentCommitId;
      if (!parentId) parentId = (await git.getParentCommitIds(commitId))[0] ?? '';
      const output = await git.diffCommits(parentId, commitId);
      const diffs: SingleFileDiff[] = [];
      for (const line of output.split('\n')) {
        const match = line.match(/^diff --git a\/(.+) b\/(.+)/);
        if (!match) continue;
        const relativePath = match[2];
        const path = resolvePath(rootPath, relativePath);
        const latter = await gitContent(
          path,
          await git.getFileContentAtCommit(commitId, relativePath)
        );
        let former: FileContent = { kind: 'text', content: '' };
        if (parentId)
          former = await gitContent(path, await git.getFileContentAtCommit(parentId, relativePath));
        if (former.kind === 'binary' || latter.kind === 'binary') {
          await openBinaryFile(path, former, parentId);
          await openBinaryFile(path, latter, commitId);
          continue;
        }
        diffs.push(singleFileDiff(path, parentId, commitId, former.content, latter.content));
      }
      if (diffs.length === 0) return;
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
