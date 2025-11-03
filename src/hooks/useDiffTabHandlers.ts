import { useCallback } from 'react';

import { GitCommands } from '@/engine/cmd/git';
import { useTabContext } from '@/context/TabContext';
import type { SingleFileDiff } from '@/types';

/**
 * [NEW ARCHITECTURE] Git Diff タブを開くための Hook
 * TabContext を使用して、Diff タブを開く
 */
export function useDiffTabHandlers(currentProject: any) {
  const { openTab } = useTabContext();

  // ファイル単体のdiffタブを開く
  const handleDiffFileClick = useCallback(
    async ({
      commitId,
      filePath,
      editable,
    }: {
      commitId: string;
      filePath: string;
      editable?: boolean;
    }) => {
      if (!currentProject) return;
      const git = new GitCommands(currentProject.name, currentProject.id);

      // working directory vs コミット のdiffの場合（editableがtrueの場合のみ）
      // GitPanelのunstaged/stagedファイルから開かれた場合
      if (editable === true && commitId && commitId.length >= 6 && commitId !== 'WORKDIR') {
        // 最新コミットのhashが渡された場合、working directoryと比較
        // latest commitの内容
        const formerCommitId = commitId;
        const latterCommitId = 'WORKDIR';
        const formerContent = await git.getFileContentAtCommit(formerCommitId, filePath);

        // working directoryの内容
        let latterContent = '';
        try {
          // まずfileRepositoryから最新の内容を取得を試みる
          const { fileRepository } = await import('@/engine/core/fileRepository');
          try {
            const allFiles = await fileRepository.getProjectFiles(currentProject.id);
            const targetFile = allFiles.find(f => f.path === filePath);
            if (targetFile && targetFile.content) {
              latterContent = targetFile.content;
              console.log('[useDiffTabHandlers] Read latterContent from fileRepository (latest)');
            } else {
              throw new Error('File not found in repository');
            }
          } catch (repoError) {
            // fileRepositoryから取得できない場合は、gitFileSystemから取得
            console.log('[useDiffTabHandlers] Falling back to gitFileSystem');
            const { gitFileSystem } = await import('@/engine/core/gitFileSystem');

            try {
              // gitFileSystem.readFileを使用（Git用ワークスペースから読み取り）
              latterContent = await gitFileSystem.readFile(currentProject.name, filePath);
              console.log('[useDiffTabHandlers] Read latterContent from gitFileSystem');
            } catch (fsError) {
              console.error('[useDiffTabHandlers] Failed to read from gitFileSystem:', fsError);
              latterContent = '';
            }
          }
          console.log('[useDiffTabHandlers] Read latterContent:', latterContent.substring(0, 100));
        } catch (e) {
          console.error('[useDiffTabHandlers] Failed to read latterContent:', e);
          latterContent = '';
        }

        // [NEW ARCHITECTURE] openTab with kind: 'diff'
        const diffData: SingleFileDiff = {
          formerFullPath: filePath,
          formerCommitId: formerCommitId,
          latterFullPath: filePath,
          latterCommitId: 'WORKDIR',
          formerContent,
          latterContent,
        };

        openTab(
          {
            files: diffData,
            editable: editable ?? true,
          },
          { kind: 'diff' }
        );
        return;
      }

      // 通常のコミット間diff
      // 指定コミットの親を取得
      const log = await git.getFormattedLog(20);
      const lines = log.split('\n');
      const idx = lines.findIndex(line => line.startsWith(commitId));
      let parentCommitId = '';
      if (idx !== -1) {
        const parts = lines[idx].split('|');
        if (parts.length >= 5) {
          const parentHashes = parts[4].trim();
          parentCommitId = parentHashes.split(',')[0] || '';
        }
      }

      console.log('[useDiffTabHandlers] Commit diff:', { commitId, parentCommitId, filePath });

      const latterCommitId = commitId;
      const formerCommitId = parentCommitId;

      // コミット間のコンテンツを取得（エラーハンドリング付き）
      let latterContent = '';
      let formerContent = '';

      try {
        if (latterCommitId) {
          latterContent = await git.getFileContentAtCommit(latterCommitId, filePath);
          console.log('[useDiffTabHandlers] Latter content length:', latterContent.length);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get latter content:', error);
        latterContent = '';
      }

      try {
        if (formerCommitId) {
          formerContent = await git.getFileContentAtCommit(formerCommitId, filePath);
          console.log('[useDiffTabHandlers] Former content length:', formerContent.length);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get former content:', error);
        formerContent = '';
      }

      // [NEW ARCHITECTURE] openTab with kind: 'diff'
      const diffData: SingleFileDiff = {
        formerFullPath: filePath,
        formerCommitId: formerCommitId,
        latterFullPath: filePath,
        latterCommitId: latterCommitId,
        formerContent,
        latterContent,
      };

      openTab(
        {
          files: diffData,
          editable: editable ?? false,
        },
        { kind: 'diff' }
      );
    },
    [currentProject, openTab]
  );

  // コミット全体のdiffタブを開く（全ファイルを1つのタブで縦並び表示）
  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const git = new GitCommands(currentProject.name, currentProject.id);

      // defensive: if parentCommitId is not provided, try to resolve it from the commit log
      if (!parentCommitId) {
        try {
          const log = await git.getFormattedLog(20);
          const lines = log.split('\n');
          const idx = lines.findIndex(line => line.startsWith(commitId));
          if (idx !== -1) {
            const parts = lines[idx].split('|');
            if (parts.length >= 5) {
              const parentHashes = parts[4].trim();
              parentCommitId = parentHashes.split(',')[0] || '';
            }
          }
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to resolve parentCommitId from log:', e);
        }
      }

      // 差分ファイル一覧を取得
      const diffOutput = await git.diffCommits(parentCommitId, commitId);

      // 変更ファイルを抽出
      const files: string[] = [];
      const lines = diffOutput.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('diff --git ')) {
          const match = line.match(/diff --git a\/(.+) b\/(.+)/);
          if (match) {
            files.push(match[2]);
          }
        }
      }

      // 各ファイルごとにdiff情報を取得
      const diffs: SingleFileDiff[] = [];
      for (const filePath of files) {
        let latterContent = '';
        let formerContent = '';

        // Latter content: content at `commitId` (may not exist for deleted files)
        try {
          if (commitId) {
            latterContent = await git.getFileContentAtCommit(commitId, filePath);
          }
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to read latterContent', {
            filePath,
            commitId,
            error: e,
          });
          latterContent = '';
        }

        // Former content: content at `parentCommitId` (may not exist for newly added files or root commit)
        try {
          if (parentCommitId) {
            formerContent = await git.getFileContentAtCommit(parentCommitId, filePath);
          } else {
            formerContent = '';
          }
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to read formerContent', {
            filePath,
            parentCommitId,
            error: e,
          });
          formerContent = '';
        }

        diffs.push({
          formerFullPath: filePath,
          formerCommitId: parentCommitId,
          latterFullPath: filePath,
          latterCommitId: commitId,
          formerContent,
          latterContent,
        });
      }

      // [NEW ARCHITECTURE] openTab with kind: 'diff' and multiple files
      openTab(
        {
          files: diffs,
          editable: false,
          isMultiFile: true,
        },
        { kind: 'diff' }
      );
    },
    [currentProject, openTab]
  );

  return { handleDiffFileClick, handleDiffAllFilesClick };
}
