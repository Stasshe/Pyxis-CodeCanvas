export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  timestamp: number;
  branch: string;
  isMerge: boolean;
  parentHashes: string[];
  /**
   * UI表示専用: このコミットが属するブランチ名（複数可）
   * UIでの色分け・ラベル表示用。ロジック処理には使わないこと。
   */
  uiBranches?: string[];
}

export interface GitBranch {
  name: string;
  isCurrent: boolean;
  isRemote: boolean;
  lastCommit?: string;
}

export interface GitStatus {
  staged: string[];
  unstaged: string[];
  untracked: string[];
  branch: string;
  ahead: number;
  behind: number;
}

export interface GitRepository {
  initialized: boolean;
  branches: GitBranch[];
  commits: GitCommit[];
  status: GitStatus;
  currentBranch: string;
}
