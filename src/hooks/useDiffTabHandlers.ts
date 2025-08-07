
import { useCallback } from 'react';
import { GitCommands } from '@/utils/cmd/git';
import type { Tab, SingleFileDiff } from '@/types';

export function useDiffTabHandlers(currentProject: any, setTabs: React.Dispatch<React.SetStateAction<Tab[]>>, setActiveTabId: (id: string) => void) {
  // ファイル単体のdiffタブを開く
  const handleDiffFileClick = useCallback(async ({ commitId, filePath }: { commitId: string; filePath: string }) => {
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
      setTabs(prevTabs => {
        const existing = prevTabs.find(tab => tab.id === diffTabId);
        if (existing) {
          setActiveTabId(diffTabId);
          return prevTabs;
        }
        const shortFormer = formerCommitId ? formerCommitId.slice(0, 6) : '';
        const newTab = {
          id: diffTabId,
          name: `Diff: ${filePath} (${shortFormer}..WD)` ,
          content: '',
          isDirty: false,
          path: filePath,
          fullPath: filePath,
          preview: false,
          isCodeMirror: false,
          diffProps: {
            diffs: [
              {
                formerFullPath: filePath,
                formerCommitId: formerCommitId,
                latterFullPath: filePath,
                latterCommitId: 'WORKDIR',
                formerContent,
                latterContent
              }
            ]
          }
        };
        setActiveTabId(diffTabId);
        return [...prevTabs, newTab];
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
    const latterContent = latterCommitId ? await git.getFileContentAtCommit(latterCommitId, filePath) : '';
    const formerContent = formerCommitId ? await git.getFileContentAtCommit(formerCommitId, filePath) : '';
    const diffTabId = `diff-${formerCommitId}-${latterCommitId}-${filePath}`;
    setTabs(prevTabs => {
      const existing = prevTabs.find(tab => tab.id === diffTabId);
      if (existing) {
        setActiveTabId(diffTabId);
        return prevTabs;
      }
      // commitidは6桁のみ表示
      const shortFormer = formerCommitId ? formerCommitId.slice(0, 6) : '';
      const shortLatter = latterCommitId ? latterCommitId.slice(0, 6) : '';
      const newTab = {
        id: diffTabId,
        name: `Diff: ${filePath} (${shortFormer}..${shortLatter})`,
        content: '',
        isDirty: false,
        path: filePath,
        fullPath: filePath,
        preview: false,
        isCodeMirror: false,
        diffProps: {
          diffs: [
            {
              formerFullPath: filePath,
              formerCommitId: formerCommitId,
              latterFullPath: filePath,
              latterCommitId: latterCommitId,
              formerContent,
              latterContent
            }
          ]
        }
      };
      setActiveTabId(diffTabId);
      return [...prevTabs, newTab];
    });
  }, [currentProject, setTabs, setActiveTabId]);

  // コミット全体のdiffタブを開く（全ファイルを1つのタブで縦並び表示）
  const handleDiffAllFilesClick = useCallback(async ({ commitId, parentCommitId }: { commitId: string; parentCommitId: string }) => {
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
        latterContent
      });
    }
    const diffTabId = `diff-all-${parentCommitId}-${commitId}`;
    setTabs(prevTabs => {
      const existing = prevTabs.find(tab => tab.id === diffTabId);
      if (existing) {
        setActiveTabId(diffTabId);
        return prevTabs;
      }
      // commitidは6桁のみ表示
      const shortFormer = parentCommitId ? parentCommitId.slice(0, 6) : '';
      const shortLatter = commitId ? commitId.slice(0, 6) : '';
      const newTab = {
        id: diffTabId,
        name: `Diff: ${shortFormer}..${shortLatter}`,
        content: '',
        isDirty: false,
        path: '',
        fullPath: '',
        preview: false,
        isCodeMirror: false,
        diffProps: {
          diffs
        }
      };
      setActiveTabId(diffTabId);
      return [...prevTabs, newTab];
    });
  }, [currentProject, setTabs, setActiveTabId]);

  return { handleDiffFileClick, handleDiffAllFilesClick };
}
