import { useCallback } from 'react';

import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { normalizePath, toGitPath } from '@/engine/core/fileRepository'; //  toGitPath 追加
import { useTabStore } from '@/stores/tabStore';
import type { SingleFileDiff } from '@/types';
import { getWorkdirContent, getStagedContent, getCommitContent } from './diffUtils';

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
      staged,
    }: {
      commitId: string;
      filePath: string;
      editable?: boolean;
      staged?: boolean;
    }) => {
      if (!currentProject) return;

      //  fileRepository用に正規化（先頭スラッシュあり）
      const normalizedPath = normalizePath(filePath);
      //  Git API用に変換（先頭スラッシュなし）
      const gitPath = toGitPath(normalizedPath);

      console.log(
        `[useDiffTabHandlers] Path: Git="${filePath}" → Repo="${normalizedPath}" → Git API="${gitPath}"`
      );

      const git = terminalCommandRegistry.getGitCommands(currentProject.name, currentProject.id);

      // NOTE: diff 操作用のヘルパは分割されたユーティリティへ移動しました（diffUtils）

      // ---------- staged な比較を優先するケース ----------
      if (staged === true) {
        // edited==true の場合は (STAGED) vs (WORKDIR)
        // edited==false の場合は (HEAD commit) vs (STAGED)
        // commitId は HEAD のコミットを渡す前提
        const headCommitId = commitId;

        // HEAD の内容を取得（存在しない場合は空文字）
        let headContent = '';
        try {
          headContent = await getCommitContent(git, headCommitId, gitPath);
          console.log('[useDiffTabHandlers] Head content length:', headContent.length);
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to read head content for staged diff', e);
          headContent = '';
        }

        // staged のコンテンツを復元（HEAD に staged の diff を適用）
        let stagedContent = '';
        try {
          stagedContent = await getStagedContent(git, headCommitId, gitPath);
          console.log('[useDiffTabHandlers] Reconstructed staged content length:', stagedContent.length);
        } catch (e) {
          console.warn('[useDiffTabHandlers] Failed to reconstruct staged content from diff', e);
          stagedContent = '';
        }

        if (editable === true) {
          // STAGED vs WORKDIR
          const formerCommitId = 'STAGED';
          const latterCommitId = 'WORKDIR';

          const latterContent = await getWorkdirContent(currentProject, normalizedPath, gitPath);

          const diffData: SingleFileDiff = {
            formerFullPath: normalizedPath,
            formerCommitId,
            latterFullPath: normalizedPath,
            latterCommitId,
            formerContent: stagedContent,
            latterContent,
          };

          openTab(
            {
              files: diffData,
              editable: true,
            },
            { kind: 'diff', searchAllPanesForReuse: true }
          );
          return;
        }

        // read-only: HEAD vs STAGED
        const formerCommitId = headCommitId || '';
        const latterCommitId = 'STAGED';

        const diffData: SingleFileDiff = {
          formerFullPath: normalizedPath,
          formerCommitId,
          latterFullPath: normalizedPath,
          latterCommitId,
          formerContent: headContent,
          latterContent: stagedContent,
        };

        openTab(
          {
            files: diffData,
            editable: false,
          },
          { kind: 'diff', searchAllPanesForReuse: true }
        );

        return;
      }

      // ---------- 既存のワーキングディレクトリ比較（editable==true） ----------
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

          if (file?.content) {
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
          { kind: 'diff', searchAllPanesForReuse: true }
        );
        return;
      }

      // 通常のコミット間diff - 高速に親コミットを取得
      const parentHashes = await git.getParentCommitIds(commitId);
      const parentCommitId = parentHashes[0] || '';

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

  return { handleDiffFileClick, handleDiffAllFilesClick };
}
