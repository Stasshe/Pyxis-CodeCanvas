import { useCallback } from 'react';

import { GitCommands } from '@/engine/cmd/git';
import { openOrActivateTab } from '@/engine/openTab';
import type { Tab, SingleFileDiff, FileItem } from '@/types';

export function useDiffTabHandlers(
  currentProject: any,
  setTabs: React.Dispatch<React.SetStateAction<Tab[]>>,
  setActiveTabId: (id: string) => void
) {
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
      // working directory vs 最新コミット のdiffの場合
      if (commitId && commitId.length >= 6 && commitId !== 'WORKDIR') {
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
        const diffTabId = `diff-${formerCommitId}-WORKDIR-${filePath}`;

        // 既存タブを検索して、あれば更新してアクティブ化
        setTabs((prevTabs: Tab[]) => {
          const existingTab = prevTabs.find(tab => tab.id === diffTabId);

          if (existingTab) {
            // 既存のworking directory diffタブがある場合は、常に内容を保持
            // （編集内容を失わないため）
            console.log(
              '[useDiffTabHandlers] Existing WD diff tab found, preserving content:',
              diffTabId
            );
            setActiveTabId(diffTabId);
            return prevTabs;
          } else {
            // 新規タブを作成
            console.log('[useDiffTabHandlers] Creating new diff tab:', diffTabId);
            const newTab: Tab = {
              id: diffTabId,
              name: `Diff: ${filePath} (${formerCommitId ? formerCommitId.slice(0, 6) : ''}..WD)`,
              content: '',
              isDirty: false,
              path: filePath,
              fullPath: filePath,
              diffProps: {
                diffs: [
                  {
                    formerFullPath: filePath,
                    formerCommitId: formerCommitId,
                    latterFullPath: filePath,
                    latterCommitId: 'WORKDIR',
                    formerContent,
                    latterContent,
                  },
                ],
                editable: editable ?? true,
              },
            };
            setActiveTabId(diffTabId);
            return [...prevTabs, newTab];
          }
        });
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
      const latterCommitId = commitId;
      const formerCommitId = parentCommitId;
      const latterContent = latterCommitId
        ? await git.getFileContentAtCommit(latterCommitId, filePath)
        : '';
      const formerContent = formerCommitId
        ? await git.getFileContentAtCommit(formerCommitId, filePath)
        : '';
      const diffTabId = `diff-${formerCommitId}-${latterCommitId}-${filePath}`;

      // 既存タブを検索して、あれば更新してアクティブ化
      setTabs((prevTabs: Tab[]) => {
        const existingTab = prevTabs.find(tab => tab.id === diffTabId);

        if (existingTab) {
          // コミット間のdiffは常に編集不可なので、内容を更新しない
          console.log(
            '[useDiffTabHandlers] Activating existing diff tab (commit-to-commit):',
            diffTabId
          );
          setActiveTabId(diffTabId);
          return prevTabs;
        } else {
          // 新規タブを作成
          console.log('[useDiffTabHandlers] Creating new diff tab:', diffTabId);
          const newTab: Tab = {
            id: diffTabId,
            name: `Diff: ${filePath} (${formerCommitId ? formerCommitId.slice(0, 6) : ''}..${latterCommitId ? latterCommitId.slice(0, 6) : ''})`,
            content: '',
            isDirty: false,
            path: filePath,
            fullPath: filePath,
            diffProps: {
              diffs: [
                {
                  formerFullPath: filePath,
                  formerCommitId: formerCommitId,
                  latterFullPath: filePath,
                  latterCommitId: latterCommitId,
                  formerContent,
                  latterContent,
                },
              ],
              editable: editable ?? false,
            },
          };
          setActiveTabId(diffTabId);
          return [...prevTabs, newTab];
        }
      });
    },
    [currentProject, setTabs, setActiveTabId]
  );

  // コミット全体のdiffタブを開く（全ファイルを1つのタブで縦並び表示）
  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const git = new GitCommands(currentProject.name, currentProject.id);
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
        const latterContent = await git.getFileContentAtCommit(commitId, filePath);
        const formerContent = await git.getFileContentAtCommit(parentCommitId, filePath);
        diffs.push({
          formerFullPath: filePath,
          formerCommitId: parentCommitId,
          latterFullPath: filePath,
          latterCommitId: commitId,
          formerContent,
          latterContent,
        });
      }
      const diffTabId = `diff-all-${parentCommitId}-${commitId}`;
      const fileItem: FileItem = {
        id: diffTabId,
        name: `Diff: ${parentCommitId ? parentCommitId.slice(0, 6) : ''}..${commitId ? commitId.slice(0, 6) : ''}`,
        path: '',
        content: '',
        type: 'file',
      };
      openOrActivateTab(fileItem, [], setTabs, setActiveTabId);
      setTabs((prevTabs: Tab[]) => {
        return prevTabs.map(tab =>
          tab.id === diffTabId
            ? {
                ...tab,
                diffProps: {
                  diffs,
                },
              }
            : tab
        );
      });
    },
    [currentProject, setTabs, setActiveTabId]
  );

  return { handleDiffFileClick, handleDiffAllFilesClick };
}
