/**
 * git push 実装
 * isomorphic-gitを使用してリモートリポジトリにプッシュ
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';
import { authRepository } from '@/engine/core/authRepository';

export interface PushOptions {
  remote?: string; // デフォルト: 'origin'
  branch?: string; // デフォルト: 現在のブランチ
  force?: boolean; // 強制プッシュ
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

    // 現在のブランチを取得（branchが指定されていない場合）
    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (!currentBranch) {
        throw new Error('No branch checked out');
      }
      targetBranch = currentBranch;
    }

    // リモートURLを取得
    const remoteUrl = await getRemoteUrl(fs, dir, remote);
    if (!remoteUrl) {
      throw new Error(`Remote '${remote}' not found. Use 'git remote add origin <url>' first.`);
    }

    console.log(`[git push] Pushing ${targetBranch} to ${remote} (${remoteUrl})`);

    // プッシュ実行
    const result = await git.push({
      fs,
      http,
      dir,
      remote,
      ref: targetBranch,
      force,
      onAuth: () => ({
        username: token,
        password: 'x-oauth-basic', // GitHubのOAuth token認証
      }),
      onAuthFailure: () => {
        throw new Error('Authentication failed. Please sign in again.');
      },
      onProgress: (progress) => {
        console.log(`[git push] Progress: ${progress.phase} ${progress.loaded}/${progress.total}`);
      },
    });

    console.log('[git push] Push successful:', result);

    return `Successfully pushed to ${remote}/${targetBranch}`;
  } catch (error: any) {
    console.error('[git push] Error:', error);

    // エラーメッセージを分かりやすく変換
    if (error.message.includes('authentication')) {
      throw new Error('Authentication failed. Please sign in to GitHub again.');
    } else if (error.message.includes('rejected')) {
      throw new Error(
        'Push rejected. Try pulling the latest changes first or use --force to force push.'
      );
    } else if (error.message.includes('network')) {
      throw new Error('Network error. Please check your internet connection.');
    } else if (error.message.includes('CORS')) {
      throw new Error(
        'CORS error. This may be due to browser restrictions. Try using the GitHub Desktop app or git CLI.'
      );
    } else {
      throw new Error(`Push failed: ${error.message}`);
    }
  }
}

/**
 * リモートURLを取得
 */
async function getRemoteUrl(fs: FS, dir: string, remote: string): Promise<string | null> {
  try {
    const configPath = `${dir}/.git/config`;
    const configContent = await fs.promises.readFile(configPath, 'utf8');
    
    // .git/configからリモートURLを抽出
    const remoteSection = new RegExp(
      `\\[remote "${remote}"\\]\\s+url\\s*=\\s*(.+)`,
      'i'
    );
    const match = (configContent as string).match(remoteSection);
    
    if (match && match[1]) {
      return match[1].trim();
    }

    return null;
  } catch (error) {
    console.error('[push] Error reading remote URL:', error);
    return null;
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
