/**
 * GitHub Git Data API Client
 * https://docs.github.com/en/rest/git
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
}

export interface GitTreeEntry {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha?: string;
  content?: string;
}

export interface GitBlob {
  sha: string;
  content: string;
  encoding: string;
}

export class GitHubAPI {
  private baseUrl: string;
  private token: string;

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/vnd.github.v3+json',
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
    } catch (error: any) {
      // 404 or 409 = ブランチが存在しない
      if (error.message.includes('404') || error.message.includes('409')) {
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
  async updateRef(branch: string, sha: string, force: boolean = false): Promise<GitRef> {
    try {
      // 既存の参照を更新
      return await this.request<GitRef>(`/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sha,
          force,
        }),
      });
    } catch (error: any) {
      if (error.message.includes('404')) {
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
  async getTree(sha: string, recursive: boolean = false): Promise<GitTree> {
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
   * コミットを取得
   */
  async getCommit(sha: string): Promise<GitCommit> {
    return this.request<GitCommit>(`/git/commits/${sha}`);
  }
}
