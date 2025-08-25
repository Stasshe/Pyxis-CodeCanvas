// src/app/gitHooks.ts
// page.tsx から Git 関連のロジックを分離
import { GitCommands } from '@/utils/cmd/git';

import type { Tab, FileItem, Project } from '@/types';
import type { Dispatch, SetStateAction } from 'react';

export function useGitMonitor({
  currentProject,
  setGitRefreshTrigger,
  setGitChangesCount,
}: {
  currentProject: Project | null;
  loadProject: any;
  saveFile: any;
  deleteFile: any;
  tabs: Tab[];
  setTabs: (update: any) => void;
  activeTabId: string;
  setActiveTabId: (id: string) => void;
  projectFiles: FileItem[];
  setGitRefreshTrigger: Dispatch<SetStateAction<number>>;
  setNodeRuntimeOperationInProgress: (v: boolean) => void;
  refreshProjectFiles: any;
  setGitChangesCount: (n: number) => void;
  gitRefreshTrigger: number;
}) {
  // Git状態を独立して監視
  return {
    checkGitStatus: async () => {
      if (!currentProject) {
        setGitChangesCount(0);
        return;
      }
      try {
        const gitCommands = new GitCommands(currentProject.name, async (path: string, type: 'file' | 'folder' | 'delete', content?: string) => {
          setTimeout(() => {
            setGitRefreshTrigger((prev: number) => prev + 1);
          }, 200);
        });
        const statusResult = await gitCommands.status();
        const changesCount = parseGitStatus(statusResult);
        setGitChangesCount(changesCount);
      } catch (error) {
        setGitChangesCount(0);
      }
    }
  };
}

export function parseGitStatus(statusOutput: string) {
  const lines = statusOutput.split('\n').map(line => line.trim()).filter(Boolean);
  let staged = 0, unstaged = 0, untracked = 0;
  let inChangesToBeCommitted = false;
  let inChangesNotStaged = false;
  let inUntrackedFiles = false;
  for (const line of lines) {
    if (line === 'Changes to be committed:') {
      inChangesToBeCommitted = true;
      inChangesNotStaged = false;
      inUntrackedFiles = false;
    } else if (line === 'Changes not staged for commit:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = true;
      inUntrackedFiles = false;
    } else if (line === 'Untracked files:') {
      inChangesToBeCommitted = false;
      inChangesNotStaged = false;
      inUntrackedFiles = true;
    } else if (line.startsWith('modified:') || line.startsWith('new file:') || line.startsWith('deleted:')) {
      if (inChangesToBeCommitted) staged++;
      else if (inChangesNotStaged) unstaged++;
    } else if (inUntrackedFiles && !line.includes('use "git add"') && !line.includes('to include') && !line.endsWith('/')) {
      untracked++;
    }
  }
  return staged + unstaged + untracked;
}

