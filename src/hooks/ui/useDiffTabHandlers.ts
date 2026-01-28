import { useCallback } from 'react';

import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { normalizePath, toGitPath } from '@/engine/core/fileRepository'; //  toGitPath 追加
import { tabActions } from '@/stores/tabState';
import type { SingleFileDiff } from '@/types';

/**
 * [NEW ARCHITECTURE] Git Diff タブを開くための Hook
 * パス正規化対応版 - Git APIには先頭スラッシュなしで渡す
 *
 * VSCode-style diff behavior:
 * - Staged files: HEAD vs INDEX (staged content)
 * - Unstaged files: INDEX vs WORKDIR (if file is also staged), otherwise HEAD vs WORKDIR
 */
export function useDiffTabHandlers(currentProject: any) {
  const { openTab } = tabActions;

  /**
   * [VSCode-style] ステージ済みファイルのdiffを開く
   * 比較: HEAD (コミット済み) vs INDEX (ステージ済み)
   */
  const handleStagedFileDiff = useCallback(
    async (filePath: string) => {
      if (!currentProject) return;

      const normalizedPath = normalizePath(filePath);
      const gitPath = toGitPath(normalizedPath);

      console.log(`[useDiffTabHandlers] Staged diff: "${gitPath}" (HEAD vs INDEX)`);

      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // HEADの内容を取得
      let headContent = '';
      try {
        const content = await git.getHeadFileContent(gitPath);
        headContent = content || '';
      } catch (e) {
        console.warn('[useDiffTabHandlers] Failed to get HEAD content:', e);
        headContent = '';
      }

      // INDEX (ステージ済み) の内容を取得
      let stagedContent = '';
      try {
        const content = await git.getStagedFileContent(gitPath);
        stagedContent = content || '';
      } catch (e) {
        console.warn('[useDiffTabHandlers] Failed to get staged content:', e);
        stagedContent = '';
      }

      const diffData: SingleFileDiff = {
        formerFullPath: normalizedPath,
        formerCommitId: 'HEAD',
        latterFullPath: normalizedPath,
        latterCommitId: 'INDEX',
        formerContent: headContent,
        latterContent: stagedContent,
      };

      openTab(
        {
          files: diffData,
          editable: false, // ステージ済みは編集不可
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject, openTab]
  );

  /**
   * [VSCode-style] 未ステージファイルのdiffを開く
   * 比較:
   * - ファイルがステージ済みの場合: INDEX vs WORKDIR
   * - ファイルがステージされていない場合: HEAD vs WORKDIR
   */
  const handleUnstagedFileDiff = useCallback(
    async (filePath: string, stagedFiles: string[] = []) => {
      if (!currentProject) return;

      const normalizedPath = normalizePath(filePath);
      const gitPath = toGitPath(normalizedPath);

      // このファイルがステージ済みかどうかをチェック
      const isAlsoStaged = stagedFiles.some(f => {
        const normalizedStaged = normalizePath(f);
        return normalizedStaged === normalizedPath || toGitPath(normalizedStaged) === gitPath;
      });

      console.log(
        `[useDiffTabHandlers] Unstaged diff: "${gitPath}" (${isAlsoStaged ? 'INDEX' : 'HEAD'} vs WORKDIR)`
      );

      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // 比較元の内容を取得 (INDEX or HEAD)
      let formerContent = '';
      let formerCommitId = 'HEAD';

      if (isAlsoStaged) {
        // ステージ済みの場合、INDEXの内容と比較
        try {
          const content = await git.getStagedFileContent(gitPath);
          formerContent = content || '';
          formerCommitId = 'INDEX';
        } catch (e) {
          console.warn(
            '[useDiffTabHandlers] Failed to get staged content, falling back to HEAD:',
            e
          );
          // フォールバック: HEADを使用
          try {
            const content = await git.getHeadFileContent(gitPath);
            formerContent = content || '';
            formerCommitId = 'HEAD';
          } catch (e2) {
            formerContent = '';
          }
        }
      } else {
        // ステージされていない場合、HEADの内容と比較
        try {
          const content = await git.getHeadFileContent(gitPath);
          formerContent = content || '';
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to get HEAD content:', e);
          formerContent = '';
        }
      }

      // Working directoryの内容を取得
      let workdirContent = '';
      try {
        const { fileRepository } = await import('@/engine/core/fileRepository');
        const file = await fileRepository.getFileByPath(currentProject.id, normalizedPath);

        if (file?.content) {
          workdirContent = file.content;
          console.log('[useDiffTabHandlers] Read workdir content from fileRepository');
        } else {
          throw new Error('File not found in repository');
        }
      } catch (repoError) {
        console.log('[useDiffTabHandlers] Falling back to gitFileSystem');
        const { gitFileSystem } = await import('@/engine/core/gitFileSystem');

        try {
          workdirContent = await gitFileSystem.readFile(currentProject.name, gitPath);
          console.log('[useDiffTabHandlers] Read workdir content from gitFileSystem');
        } catch (fsError) {
          console.error('[useDiffTabHandlers] Failed to read from gitFileSystem:', fsError);
          workdirContent = '';
        }
      }

      const diffData: SingleFileDiff = {
        formerFullPath: normalizedPath,
        formerCommitId: formerCommitId,
        latterFullPath: normalizedPath,
        latterCommitId: 'WORKDIR',
        formerContent,
        latterContent: workdirContent,
      };

      openTab(
        {
          files: diffData,
          editable: true, // 未ステージは編集可能
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject, openTab]
  );

  // コミット履歴用: コミット間のファイル差分を開く（親コミット vs コミット）
  const handleCommitsDiff = useCallback(
    async ({
      commitId,
      filePath,
    }: {
      commitId: string;
      filePath: string;
    }) => {
      if (!currentProject) return;

      // fileRepository用に正規化（先頭スラッシュあり）
      const normalizedPath = normalizePath(filePath);
      // Git API用に変換（先頭スラッシュなし）
      const gitPath = toGitPath(normalizedPath);

      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // 親コミットを取得し、親⇄コミットの diff を表示する（履歴表示専用）
      const parentHashes = await git.getParentCommitIds(commitId);
      const parentCommitId = parentHashes[0] || '';

      let latterContent = '';
      let formerContent = '';

      try {
        if (commitId) {
          latterContent = await git.getFileContentAtCommit(commitId, gitPath);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get latter content:', error);
        latterContent = '';
      }

      try {
        if (parentCommitId) {
          formerContent = await git.getFileContentAtCommit(parentCommitId, gitPath);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get former content:', error);
        formerContent = '';
      }

      const diffData: SingleFileDiff = {
        formerFullPath: normalizedPath,
        formerCommitId: parentCommitId,
        latterFullPath: normalizedPath,
        latterCommitId: commitId,
        formerContent,
        latterContent,
      };

      openTab(
        {
          files: diffData,
          editable: false,
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject, openTab]
  );

  // コミット全体のdiffタブを開く
  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // defensive: parentCommitIdが無い場合は高速に親を取得
      if (!parentCommitId) {
        try {
          const parentHashes = await git.getParentCommitIds(commitId);
          parentCommitId = parentHashes[0] || '';
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to resolve parentCommitId:', e);
        }
      }

      // 差分ファイル一覧を取得
      const diffOutput = await git.diffCommits(parentCommitId, commitId);

      // 変更ファイルを抽出
      const files: Array<{ gitPath: string; normalizedPath: string }> = [];
      const lines = diffOutput.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
          const match = line.match(/diff --git a\/(.+) b\/(.+)/);
          if (match) {
            //  Gitから返されるパス（先頭スラッシュなし）
            const rawGitPath = match[2];
            //  fileRepository用に正規化（先頭スラッシュあり）
            const normalizedFilePath = normalizePath(rawGitPath);

            files.push({
              gitPath: rawGitPath, // Git API用（スラッシュなし）
              normalizedPath: normalizedFilePath, // fileRepository用（スラッシュあり）
            });
          }
        }
      }

      // 各ファイルごとにdiff情報を取得
      const diffs: SingleFileDiff[] = [];

      for (const { gitPath, normalizedPath } of files) {
        let latterContent = '';
        let formerContent = '';

        //  Git APIには先頭スラッシュなしで渡す
        try {
          if (commitId) {
            latterContent = await git.getFileContentAtCommit(commitId, gitPath);
          }
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to read latterContent', {
            gitPath,
            commitId,
            error: e,
          });
          latterContent = '';
        }

        try {
          if (parentCommitId) {
            formerContent = await git.getFileContentAtCommit(parentCommitId, gitPath);
          } else {
            formerContent = '';
          }
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to read formerContent', {
            gitPath,
            parentCommitId,
            error: e,
          });
          formerContent = '';
        }

        //  DiffデータはfileRepository用の正規化されたパスで作成
        diffs.push({
          formerFullPath: normalizedPath, // fileRepository形式
          formerCommitId: parentCommitId,
          latterFullPath: normalizedPath, // fileRepository形式
          latterCommitId: commitId,
          formerContent,
          latterContent,
        });
      }

      openTab(
        {
          files: diffs,
          editable: false,
          isMultiFile: true,
        },
        { kind: 'diff', searchAllPanesForReuse: true }
      );
    },
    [currentProject, openTab]
  );

  return {
    handleCommitsDiff,
    handleDiffAllFilesClick,
    handleStagedFileDiff,
    handleUnstagedFileDiff,
  };
}
