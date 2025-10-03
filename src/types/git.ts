export interface GitCommit {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  timestamp: number;
  isMerge: boolean;
  parentHashes: string[];
  /**
   * このコミットを指しているブランチ・タグのref名（複数可）
   * 例: ['main', 'origin/main', 'v1.0.0']
   * HEADコミットのみに設定される
   */
  refs?: string[];
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
  deleted: string[]; // 削除されたファイル（未ステージ）
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
