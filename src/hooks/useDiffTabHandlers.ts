import { useCallback } from 'react';

import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { normalizePath, toGitPath } from '@/engine/core/fileRepository'; //  toGitPath 追加
import { useTabStore } from '@/stores/tabStore';
import type { SingleFileDiff } from '@/types';

/**
 * [NEW ARCHITECTURE] Git Diff タブを開くための Hook
 * パス正規化対応版 - Git APIには先頭スラッシュなしで渡す
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
      
      //  fileRepository用に正規化（先頭スラッシュあり）
      const normalizedPath = normalizePath(filePath);
      //  Git API用に変換（先頭スラッシュなし）
      const gitPath = toGitPath(normalizedPath);
      
      console.log(`[useDiffTabHandlers] Path: Git="${filePath}" → Repo="${normalizedPath}" → Git API="${gitPath}"`);
      
      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // working directory vs コミット のdiff（editableがtrueの場合）
      if (editable === true && commitId && commitId.length >= 6 && commitId !== 'WORKDIR') {
        const formerCommitId = commitId;
        const latterCommitId = 'WORKDIR';
        
        //  Git APIには先頭スラッシュなしで渡す
        const formerContent = await git.getFileContentAtCommit(formerCommitId, gitPath);

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
            //  gitFileSystemにはGit API用パスを渡す
            latterContent = await gitFileSystem.readFile(currentProject.name, gitPath);
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

      console.log('[useDiffTabHandlers] Commit diff:', { commitId, parentCommitId, normalizedPath, gitPath });

      const latterCommitId = commitId;
      const formerCommitId = parentCommitId;

      let latterContent = '';
      let formerContent = '';

      try {
        if (latterCommitId) {
          //  Git APIには先頭スラッシュなしで渡す
          latterContent = await git.getFileContentAtCommit(latterCommitId, gitPath);
          console.log('[useDiffTabHandlers] Latter content length:', latterContent.length);
        }
      } catch (error) {
        console.error('[useDiffTabHandlers] Failed to get latter content:', error);
        latterContent = '';
      }

      try {
        if (formerCommitId) {
          //  Git APIには先頭スラッシュなしで渡す
          formerContent = await git.getFileContentAtCommit(formerCommitId, gitPath);
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
            //  Gitから返されるパス（先頭スラッシュなし）
            const rawGitPath = match[2];
            //  fileRepository用に正規化（先頭スラッシュあり）
            const normalizedPath = normalizePath(rawGitPath);
            
            files.push({
              gitPath: rawGitPath,        // Git API用（スラッシュなし）
              normalizedPath: normalizedPath  // fileRepository用（スラッシュあり）
            });
            
            console.log(`[useDiffTabHandlers] File: Git="${rawGitPath}" → Repo="${normalizedPath}"`);
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
        { kind: 'diff' }
      );
    },
    [currentProject, openTab]
  );

  return { handleDiffFileClick, handleDiffAllFilesClick };
}
