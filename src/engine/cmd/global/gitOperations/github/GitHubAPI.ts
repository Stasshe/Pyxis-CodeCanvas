/**
 * GitHub Git Data API Client
 * https://docs.github.com/en/rest/git
 *
 * Optimized for efficient push operations with:
 * - Batch commit history fetching
 * - Compare API for divergence detection
 * - Minimal API calls strategy
 */

export interface GitRef {
  ref: string;
  object: {
    sha: string;
    type: string;
  };
}

export interface GitCommit {
  sha: string;
  tree: {
    sha: string;
  };
  parents: Array<{ sha: string }>;
  message: string;
  author: GitUser;
  committer: GitUser;
}

export interface GitUser {
  name: string;
  email: string;
  date: string;
}

export interface GitTree {
  sha: string;
  tree: Array<GitTreeEntry>;
  truncated?: boolean;
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  // sha can be null when explicitly deleting an entry via the Git Data API
  sha?: string | null;
  content?: string;
}

export interface GitBlob {
  sha: string;
  content: string;
  encoding: string;
}

/**
 * Commit info from REST API (different from Git Data API)
 */
export interface CommitInfo {
  sha: string;
  commit: {
    tree: { sha: string };
    message: string;
    author: { name: string; email: string; date: string };
    committer: { name: string; email: string; date: string };
  };
  parents: Array<{ sha: string }>;
}

/**
 * Compare API response
 */
export interface CompareResult {
  status: 'diverged' | 'ahead' | 'behind' | 'identical';
  ahead_by: number;
  behind_by: number;
  total_commits: number;
  base_commit: CommitInfo;
  merge_base_commit: CommitInfo;
  commits: CommitInfo[];
}

export class GitHubAPI {
  private baseUrl: string;
  private token: string;
  private owner: string;
  private repo: string;

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ message: response.statusText }));
      throw new Error(`GitHub API error (${response.status}): ${error.message}`);
    }

    return response.json();
  }

  /**
   * 参照を取得
   */
  async getRef(branch: string): Promise<GitRef | null> {
    try {
      return await this.request<GitRef>(`/git/refs/heads/${branch}`);
    } catch (error) {
      // 404 or 409 = ブランチが存在しない
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404') || message.includes('409')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * 参照を作成
   */
  async createRef(branch: string, sha: string): Promise<GitRef> {
    return this.request<GitRef>('/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha,
      }),
    });
  }

  /**
   * 参照を更新
   */
  async updateRef(branch: string, sha: string, force = false): Promise<GitRef> {
    try {
      // 既存の参照を更新
      return await this.request<GitRef>(`/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sha,
          force,
        }),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404')) {
        // 参照が存在しない場合は新規作成
        return this.createRef(branch, sha);
      }
      throw error;
    }
  }

  /**
   * コミットを作成
   */
  async createCommit(data: {
    message: string;
    tree: string;
    parents: string[];
    author: GitUser;
    committer: GitUser;
  }): Promise<GitCommit> {
    return this.request<GitCommit>('/git/commits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  /**
   * ツリーを作成
   */
  async createTree(tree: GitTreeEntry[], baseTree?: string): Promise<GitTree> {
    return this.request<GitTree>('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        tree,
        ...(baseTree && { base_tree: baseTree }),
      }),
    });
  }

  /**
   * Blobを作成
   */
  async createBlob(content: string, encoding: 'utf-8' | 'base64' = 'utf-8'): Promise<GitBlob> {
    return this.request<GitBlob>('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({
        content,
        encoding,
      }),
    });
  }

  /**
   * ツリーを取得
   */
  async getTree(sha: string, recursive = false): Promise<GitTree> {
    const params = recursive ? '?recursive=1' : '';
    return this.request<GitTree>(`/git/trees/${sha}${params}`);
  }

  /**
   * Blobを取得
   */
  async getBlob(sha: string): Promise<GitBlob> {
    return this.request<GitBlob>(`/git/blobs/${sha}`);
  }

  /**
   * コミットを取得 (Git Data API)
   */
  async getCommit(sha: string): Promise<GitCommit> {
    return this.request<GitCommit>(`/git/commits/${sha}`);
  }

  /**
   * ツリーが存在するかチェック（軽量）
   */
  async treeExists(sha: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/git/trees/${sha}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      return response.ok;
    } catch (error) {
      console.warn('[GitHubAPI] treeExists network error:', error);
      return false;
    }
  }

  /**
   * コミットのツリーSHAを効率的に取得
   */
  async getCommitTree(commitSha: string): Promise<string> {
    const commit = await this.getCommit(commitSha);
    return commit.tree.sha;
  }

  /**
   * 2つのツリーが同一かチェック
   */
  async treesAreEqual(treeSha1: string, treeSha2: string): Promise<boolean> {
    return treeSha1 === treeSha2;
  }

  // ========================================
  // 高速化用の新しいAPI
  // ========================================

  /**
   * コミット履歴をバッチ取得（REST API）
   * 1回のリクエストで最大100件のコミットを取得
   *
   * @param sha - 開始コミットのSHA
   * @param perPage - 1ページあたりの取得件数（最大100）
   * @param page - ページ番号（1から開始、将来の拡張用）
   */
  async getCommitHistory(sha: string, perPage = 100, page = 1): Promise<CommitInfo[]> {
    try {
      return await this.request<CommitInfo[]>(
        `/commits?sha=${sha}&per_page=${perPage}&page=${page}`
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('409')) {
        // Empty repository
        return [];
      }
      throw error;
    }
  }

  /**
   * 2つのコミット間の比較（Compare API）
   * 効率的に差分情報を取得
   */
  async compareCommits(base: string, head: string): Promise<CompareResult | null> {
    try {
      return await this.request<CompareResult>(`/compare/${base}...${head}`);
    } catch (error) {
      // 404 = 共通の祖先がない（比較不可）
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

  /**
   * コミットが存在するかチェック（軽量）
   */
  async commitExists(sha: string): Promise<boolean> {
    try {
      const url = `${this.baseUrl}/git/commits/${sha}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: 'application/vnd.github.v3+json',
        },
      });

      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * コミット情報を取得（REST API - ツリーSHA含む）
   */
  async getCommitInfo(sha: string): Promise<CommitInfo> {
    return this.request<CommitInfo>(`/commits/${sha}`);
  }
}
