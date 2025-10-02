/**
 * git push 実装
 * GitHub REST APIを使用してリモートリポジトリにプッシュ
 */

import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';
import { authRepository } from '@/engine/core/authRepository';

export interface PushOptions {
  remote?: string; // デフォルト: 'origin'
  branch?: string; // デフォルト: 現在のブランチ
  force?: boolean; // 強制プッシュ
}

/**
 * GitHubのリポジトリ情報を解析
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  // https://github.com/owner/repo.git 形式
  const httpsMatch = url.match(/https:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // git@github.com:owner/repo.git 形式
  const sshMatch = url.match(/git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  return null;
}

/**
 * GitHub REST APIでファイルを更新
 */
async function updateFileViaAPI(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  content: string,
  message: string,
  sha?: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  
  const body: any = {
    message,
    content: btoa(unescape(encodeURIComponent(content))), // Base64エンコード
    branch,
  };

  if (sha) {
    body.sha = sha; // 既存ファイルの場合はSHAが必要
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to update ${path}: ${error.message || response.statusText}`);
  }
}

/**
 * GitHub REST APIでファイルを削除
 */
async function deleteFileViaAPI(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string,
  message: string,
  sha: string
): Promise<void> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  
  const response = await fetch(url, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sha,
      branch,
    }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Failed to delete ${path}: ${error.message || response.statusText}`);
  }
}

/**
 * GitHub REST APIでファイル情報を取得
 */
async function getFileInfo(
  token: string,
  owner: string,
  repo: string,
  branch: string,
  path: string
): Promise<{ sha: string; content: string } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;
  
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });

  if (response.status === 404) {
    return null; // ファイルが存在しない
  }

  if (!response.ok) {
    throw new Error(`Failed to get file info: ${response.statusText}`);
  }

  const data = await response.json();
  return {
    sha: data.sha,
    content: decodeURIComponent(escape(atob(data.content.replace(/\s/g, '')))),
  };
}

/**
 * ローカルのコミットツリーからファイル一覧を取得
 */
async function getTreeFiles(
  fs: FS,
  dir: string,
  commitOid: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  
  // コミットオブジェクトを取得
  const commit = await git.readCommit({ fs, dir, oid: commitOid });
  const treeOid = commit.commit.tree;
  
  // ツリーを再帰的に走査
  async function walkTree(treeOid: string, prefix: string = '') {
    const tree = await git.readTree({ fs, dir, oid: treeOid });
    
    for (const entry of tree.tree) {
      const path = prefix ? `${prefix}/${entry.path}` : entry.path;
      
      if (entry.type === 'blob') {
        files.set(path, entry.oid);
      } else if (entry.type === 'tree') {
        await walkTree(entry.oid, path);
      }
    }
  }
  
  await walkTree(treeOid);
  return files;
}

/**
 * リモートのコミットツリーからファイル一覧を取得
 */
async function getRemoteTreeFiles(
  token: string,
  owner: string,
  repo: string,
  commitSha: string
): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  
  // コミットオブジェクトを取得
  const commitUrl = `https://api.github.com/repos/${owner}/${repo}/git/commits/${commitSha}`;
  const commitResponse = await fetch(commitUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  
  if (!commitResponse.ok) {
    throw new Error(`Failed to get commit: ${commitResponse.statusText}`);
  }
  
  const commitData = await commitResponse.json();
  const treeSha = commitData.tree.sha;
  
  // ツリーを再帰的に取得
  const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`;
  const treeResponse = await fetch(treeUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
    },
  });
  
  if (!treeResponse.ok) {
    throw new Error(`Failed to get tree: ${treeResponse.statusText}`);
  }
  
  const treeData = await treeResponse.json();
  
  for (const entry of treeData.tree) {
    if (entry.type === 'blob') {
      files.set(entry.path, entry.sha);
    }
  }
  
  return files;
}

/**
 * git push を実行
 */
export async function push(
  fs: FS,
  dir: string,
  options: PushOptions = {}
): Promise<string> {
  const { remote = 'origin', branch, force = false } = options;

  try {
    // 認証トークンを取得
    const token = await authRepository.getAccessToken();
    if (!token) {
      throw new Error('GitHub authentication required. Please sign in first.');
    }

    // 現在のブランチを取得
    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (!currentBranch) {
        throw new Error('No branch checked out');
      }
      targetBranch = currentBranch;
    }

    // リモートURLを取得
    const remotes = await git.listRemotes({ fs, dir });
    const remoteInfo = remotes.find(r => r.remote === remote);
    
    if (!remoteInfo) {
      throw new Error(`Remote '${remote}' not found. Use 'git remote add origin <url>' first.`);
    }

    console.log(`[git push] Pushing ${targetBranch} to ${remote} (${remoteInfo.url})`);

    // GitHubのowner/repoを解析
    const repoInfo = parseGitHubUrl(remoteInfo.url);
    if (!repoInfo) {
      throw new Error('Only GitHub repositories are supported for push via REST API');
    }

    console.log('[git push] Repository:', `${repoInfo.owner}/${repoInfo.repo}`);
    console.log('[git push] Target branch:', targetBranch);

    // ローカルの最新コミットを取得
    const localCommits = await git.log({ fs, dir, depth: 1, ref: targetBranch });
    const localCommitOid = localCommits[0]?.oid;
    
    if (!localCommitOid) {
      throw new Error('No commits found in local repository');
    }

    console.log('[git push] Local commit:', localCommitOid);

    // リモートの最新コミットを取得
    let remoteCommitOid: string | null = null;
    try {
      const refUrl = `https://api.github.com/repos/${repoInfo.owner}/${repoInfo.repo}/git/refs/heads/${targetBranch}`;
      const refResponse = await fetch(refUrl, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (refResponse.ok) {
        const refData = await refResponse.json();
        remoteCommitOid = refData.object.sha;
        console.log('[git push] Remote commit:', remoteCommitOid);
      } else if (refResponse.status === 404) {
        console.log('[git push] Remote branch does not exist yet');
      } else {
        console.warn('[git push] Failed to get remote ref:', refResponse.statusText);
      }
    } catch (error: any) {
      console.warn('[git push] Failed to fetch remote commit:', error.message);
    }

    // ローカルとリモートが同じ場合
    if (remoteCommitOid && localCommitOid === remoteCommitOid) {
      return 'Everything up-to-date';
    }

    // ローカルとリモートでコミットを比較してファイル差分を取得
    const changes: Array<{ path: string; status: 'modified' | 'added' | 'deleted' }> = [];

    if (remoteCommitOid) {
      // リモートとローカルの差分を計算
      console.log('[git push] Comparing local and remote commits...');
      
      // ローカルのファイルツリーを取得
      const localTree = await getTreeFiles(fs, dir, localCommitOid);
      console.log('[git push] Local files:', localTree.size);

      // リモートのファイルツリーを取得
      const remoteTree = await getRemoteTreeFiles(token, repoInfo.owner, repoInfo.repo, remoteCommitOid);
      console.log('[git push] Remote files:', remoteTree.size);

      // 差分を計算
      for (const [path, localSha] of localTree.entries()) {
        const remoteSha = remoteTree.get(path);
        if (!remoteSha) {
          changes.push({ path, status: 'added' });
        } else if (localSha !== remoteSha) {
          changes.push({ path, status: 'modified' });
        }
      }

      // 削除されたファイル
      for (const [path] of remoteTree.entries()) {
        if (!localTree.has(path)) {
          changes.push({ path, status: 'deleted' });
        }
      }
    } else {
      // リモートブランチが存在しない場合、すべてのファイルをプッシュ
      console.log('[git push] Remote branch does not exist, pushing all files...');
      const localTree = await getTreeFiles(fs, dir, localCommitOid);
      for (const [path] of localTree.entries()) {
        changes.push({ path, status: 'added' });
      }
    }

    if (changes.length === 0) {
      return 'Everything up-to-date';
    }

    console.log('[git push] Changes to push:', changes);

    // 最新のコミットメッセージを取得
    const commits = await git.log({ fs, dir, depth: 1, ref: targetBranch });
    const commitMessage = commits[0]?.commit.message || 'Update files';

    console.log('[git push] Commit message:', commitMessage);

    // 各ファイルをGitHub APIで更新
    let successCount = 0;
    let errorCount = 0;

    for (const change of changes) {
      try {
        console.log(`[git push] Processing ${change.status}: ${change.path}`);

        if (change.status === 'deleted') {
          // ファイル削除
          const fileInfo = await getFileInfo(token, repoInfo.owner, repoInfo.repo, targetBranch, change.path);
          if (fileInfo) {
            await deleteFileViaAPI(
              token,
              repoInfo.owner,
              repoInfo.repo,
              targetBranch,
              change.path,
              commitMessage,
              fileInfo.sha
            );
            console.log(`[git push] Deleted: ${change.path}`);
            successCount++;
          }
        } else {
          // ファイル追加/更新
          const content = await fs.promises.readFile(`${dir}/${change.path}`, 'utf8');
          const fileInfo = await getFileInfo(token, repoInfo.owner, repoInfo.repo, targetBranch, change.path);
          
          await updateFileViaAPI(
            token,
            repoInfo.owner,
            repoInfo.repo,
            targetBranch,
            change.path,
            content as string,
            commitMessage,
            fileInfo?.sha
          );
          console.log(`[git push] ${change.status === 'added' ? 'Added' : 'Updated'}: ${change.path}`);
          successCount++;
        }
      } catch (error: any) {
        console.error(`[git push] Failed to push ${change.path}:`, error.message);
        errorCount++;
      }
    }

    if (errorCount > 0) {
      throw new Error(`Push completed with errors: ${successCount} succeeded, ${errorCount} failed`);
    }

    return `Successfully pushed ${successCount} file(s) to ${remote}/${targetBranch}`;
  } catch (error: any) {
    console.error('[git push] Error:', error);

    // エラーメッセージを分かりやすく変換
    if (error.message.includes('authentication') || error.message.includes('401')) {
      throw new Error('Authentication failed. Please sign in to GitHub again.');
    } else if (error.message.includes('404')) {
      throw new Error('Repository or branch not found. Please check your remote URL and branch name.');
    } else if (error.message.includes('403')) {
      throw new Error('Permission denied. Please check your access token permissions.');
    } else {
      throw new Error(`Push failed: ${error.message}`);
    }
  }
}

/**
 * リモートを追加
 */
export async function addRemote(
  fs: FS,
  dir: string,
  remote: string,
  url: string
): Promise<string> {
  try {
    await git.addRemote({
      fs,
      dir,
      remote,
      url,
    });

    return `Remote '${remote}' added: ${url}`;
  } catch (error: any) {
    if (error.message.includes('already exists')) {
      throw new Error(`Remote '${remote}' already exists. Use 'git remote set-url' to change it.`);
    }
    throw new Error(`Failed to add remote: ${error.message}`);
  }
}

/**
 * リモート一覧を取得
 */
export async function listRemotes(fs: FS, dir: string): Promise<string> {
  try {
    const remotes = await git.listRemotes({
      fs,
      dir,
    });

    if (remotes.length === 0) {
      return 'No remotes configured.';
    }

    return remotes.map(r => `${r.remote}\t${r.url}`).join('\n');
  } catch (error: any) {
    throw new Error(`Failed to list remotes: ${error.message}`);
  }
}

/**
 * リモートを削除
 */
export async function deleteRemote(fs: FS, dir: string, remote: string): Promise<string> {
  try {
    await git.deleteRemote({
      fs,
      dir,
      remote,
    });

    return `Remote '${remote}' deleted.`;
  } catch (error: any) {
    throw new Error(`Failed to delete remote: ${error.message}`);
  }
}
