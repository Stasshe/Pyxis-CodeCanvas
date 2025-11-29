import { useCallback } from 'react';

import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { normalizePath } from '@/engine/core/fileRepository';
import { useTabStore } from '@/stores/tabStore';
import type { SingleFileDiff } from '@/types';

/**
 * [NEW ARCHITECTURE] Git Diff タブを開くための Hook
 * パス正規化対応版
 */
export function useDiffTabHandlers(currentProject: any) {
  const { openTab } = useTabStore();

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

      const normalizedPath = normalizePath(filePath);

      console.log(`[useDiffTabHandlers] Path normalized: "${filePath}" → "${normalizedPath}"`);

      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // working directory vs コミット のdiff（editableがtrueの場合）
      if (editable === true && commitId && commitId.length >= 6 && commitId !== 'WORKDIR') {
        const formerCommitId = commitId;
        const latterCommitId = 'WORKDIR';

        //  Gitには正規化されたパスを渡す
        const formerContent = await git.getFileContentAtCommit(formerCommitId, normalizedPath);

        // working directoryの内容を取得
        let latterContent = '';
        try {
          const { fileRepository } = await import('@/engine/core/fileRepository');

          //  正規化されたパスでファイルを検索
          const file = await fileRepository.getFileByPath(currentProject.id, normalizedPath);

          if (file && file.content) {
            latterContent = file.content;
            console.log('[useDiffTabHandlers] Read latterContent from fileRepository');
          } else {
            throw new Error('File not found in repository');
          }
        } catch (repoError) {
          console.log('[useDiffTabHandlers] Falling back to gitFileSystem');
          const { gitFileSystem } = await import('@/engine/core/gitFileSystem');

          try {
            //  gitFileSystemにも正規化されたパスを渡す
            latterContent = await gitFileSystem.readFile(currentProject.name, normalizedPath);
            console.log('[useDiffTabHandlers] Read latterContent from gitFileSystem');
          } catch (fsError) {
            console.error('[useDiffTabHandlers] Failed to read from gitFileSystem:', fsError);
            latterContent = '';
          }
        }

        //  Diffデータも正規化されたパスで作成
        const diffData: SingleFileDiff = {
          formerFullPath: normalizedPath,
          formerCommitId: formerCommitId,
          latterFullPath: normalizedPath,
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

      console.log('[useDiffTabHandlers] Commit diff:', { commitId, parentCommitId, normalizedPath });

      const latterCommitId = commitId;
      const formerCommitId = parentCommitId;

      let latterContent = '';
      let formerContent = '';

      try {
        if (latterCommitId) {
          //  正規化されたパスでコミットから取得
          latterContent = await git.getFileContentAtCommit(latterCommitId, normalizedPath);
          console.log('[useDiffTabHandlers] Latter content length:', latterContent.length);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get latter content:', error);
        latterContent = '';
      }

      try {
        if (formerCommitId) {
          //  正規化されたパスでコミットから取得
          formerContent = await git.getFileContentAtCommit(formerCommitId, normalizedPath);
          console.log('[useDiffTabHandlers] Former content length:', formerContent.length);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get former content:', error);
        formerContent = '';
      }

      //  Diffデータも正規化されたパスで作成
      const diffData: SingleFileDiff = {
        formerFullPath: normalizedPath,
        formerCommitId: formerCommitId,
        latterFullPath: normalizedPath,
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

  // コミット全体のdiffタブを開く
  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // defensive: parentCommitIdが無い場合は解決を試みる
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
            const rawPath = match[2];
            const normalizedPath = normalizePath(rawPath);
            files.push(normalizedPath);

            console.log(`[useDiffTabHandlers] File normalized: "${rawPath}" → "${normalizedPath}"`);
          }
        }
      }

      // 各ファイルごとにdiff情報を取得
      const diffs: SingleFileDiff[] = [];

      for (const filePath of files) {
        let latterContent = '';
        let formerContent = '';

        //  正規化されたパスでコンテンツ取得
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

        //  正規化されたパスでDiffデータ作成
        diffs.push({
          formerFullPath: filePath, // 既に正規化済み
          formerCommitId: parentCommitId,
          latterFullPath: filePath, // 既に正規化済み
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
        { kind: 'diff' }
      );
    },
    [currentProject, openTab]
  );

  return { handleDiffFileClick, handleDiffAllFilesClick };
}
