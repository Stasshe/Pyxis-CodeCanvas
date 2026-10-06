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

  sha?: string | null;
  content?: string;
}

export interface GitBlob {
  sha: string;
  content: string;
  encoding: string;
}

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

  constructor(token: string, owner: string, repo: string) {
    this.token = token;
    this.baseUrl = `https://api.github.com/repos/${owner}/${repo}`;
  }

  private async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    let url = `${this.baseUrl}${endpoint}`;
    if (endpoint.startsWith('http')) url = endpoint;
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
      const error: { message: string } = await response
        .json()
        .catch(() => ({ message: response.statusText }));
      throw new Error(`GitHub API error (${response.status}): ${error.message}`);
    }

    return response.json();
  }

  async getRef(branch: string): Promise<GitRef | null> {
    try {
      return await this.request<GitRef>(`/git/refs/heads/${branch}`);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      if (message.includes('404') || message.includes('409')) {
        return null;
      }
      throw error;
    }
  }

  async createRef(branch: string, sha: string): Promise<GitRef> {
    return this.request<GitRef>('/git/refs', {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha,
      }),
    });
  }

  async updateRef(branch: string, sha: string, force = false): Promise<GitRef> {
    try {
      return await this.request<GitRef>(`/git/refs/heads/${branch}`, {
        method: 'PATCH',
        body: JSON.stringify({
          sha,
          force,
        }),
      });
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      if (message.includes('404')) {
        return this.createRef(branch, sha);
      }
      throw error;
    }
  }

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

  async createTree(tree: GitTreeEntry[], baseTree?: string): Promise<GitTree> {
    return this.request<GitTree>('/git/trees', {
      method: 'POST',
      body: JSON.stringify({
        tree,
        ...(baseTree && { base_tree: baseTree }),
      }),
    });
  }

  async createBlob(content: string, encoding: 'utf-8' | 'base64' = 'utf-8'): Promise<GitBlob> {
    return this.request<GitBlob>('/git/blobs', {
      method: 'POST',
      body: JSON.stringify({
        content,
        encoding,
      }),
    });
  }

  async getTree(sha: string, recursive = false): Promise<GitTree> {
    let params = '';
    if (recursive) params = '?recursive=1';
    return this.request<GitTree>(`/git/trees/${sha}${params}`);
  }

  async getBlob(sha: string): Promise<GitBlob> {
    return this.request<GitBlob>(`/git/blobs/${sha}`);
  }

  async getCommit(sha: string): Promise<GitCommit> {
    return this.request<GitCommit>(`/git/commits/${sha}`);
  }

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

  async getCommitTree(commitSha: string): Promise<string> {
    const commit = await this.getCommit(commitSha);
    return commit.tree.sha;
  }

  async treesAreEqual(treeSha1: string, treeSha2: string): Promise<boolean> {
    return treeSha1 === treeSha2;
  }

  async getCommitHistory(sha: string, perPage = 100, page = 1): Promise<CommitInfo[]> {
    try {
      return await this.request<CommitInfo[]>(
        `/commits?sha=${sha}&per_page=${perPage}&page=${page}`
      );
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      if (message.includes('409')) {
        return [];
      }
      throw error;
    }
  }

  async compareCommits(base: string, head: string): Promise<CompareResult | null> {
    try {
      return await this.request<CompareResult>(`/compare/${base}...${head}`);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      if (message.includes('404')) {
        return null;
      }
      throw error;
    }
  }

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

  async getCommitInfo(sha: string): Promise<CommitInfo> {
    return this.request<CommitInfo>(`/commits/${sha}`);
  }
}
