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
    async ({ commitId, filePath }: { commitId: string; filePath: string }) => {
      if (!currentProject) return;
      const git = new GitCommands(currentProject.name);
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
          // IndexedDB上の現状ファイル内容を取得
          const fs = (git as any).fs;
          const dir = (git as any).dir;
          let relPath = filePath;
          if (relPath.startsWith('/')) relPath = relPath.slice(1);
          latterContent = await fs.promises.readFile(`${dir}/${relPath}`, 'utf8');
        } catch (e) {
          latterContent = '';
        }
        const diffTabId = `diff-${formerCommitId}-WORKDIR-${filePath}`;
        const fileItem: FileItem = {
          id: diffTabId,
          name: `Diff: ${filePath} (${formerCommitId ? formerCommitId.slice(0, 6) : ''}..WD)`,
          path: filePath,
          content: '',
          type: 'file',
        };
        openOrActivateTab(fileItem, [], setTabs, setActiveTabId);
        // diffPropsを付与
        setTabs((prevTabs: Tab[]) => {
          return prevTabs.map(tab =>
            tab.id === diffTabId
              ? {
                  ...tab,
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
                  },
                }
              : tab
          );
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
      const fileItem2: FileItem = {
        id: diffTabId,
        name: `Diff: ${filePath} (${formerCommitId ? formerCommitId.slice(0, 6) : ''}..${latterCommitId ? latterCommitId.slice(0, 6) : ''})`,
        path: filePath,
        content: '',
        type: 'file',
      };
      openOrActivateTab(fileItem2, [], setTabs, setActiveTabId);
      setTabs((prevTabs: Tab[]) => {
        return prevTabs.map(tab =>
          tab.id === diffTabId
            ? {
                ...tab,
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
                },
              }
            : tab
        );
      });
    },
    [currentProject, setTabs, setActiveTabId]
  );

  // コミット全体のdiffタブを開く（全ファイルを1つのタブで縦並び表示）
  const handleDiffAllFilesClick = useCallback(
    async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
      if (!currentProject) return;
      const git = new GitCommands(currentProject.name);
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
