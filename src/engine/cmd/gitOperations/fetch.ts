/**
 * git fetch 実装
 * GitHub APIを使用してリモートの参照を取得
 */

import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import FS from '@isomorphic-git/lightning-fs';
import { authRepository } from '@/engine/core/authRepository';
import { parseGitHubUrl } from './github/utils';

export interface FetchOptions {
  remote?: string;
  branch?: string;
  depth?: number;
  prune?: boolean;
  tags?: boolean;
}

export async function fetch(
  fs: FS,
  dir: string,
  options: FetchOptions = {}
): Promise<string> {
  const {
    remote = 'origin',
    branch,
    depth,
    prune = false,
    tags = false,
  } = options;

  try {
    const token = await authRepository.getAccessToken();
    
    // リモート情報を取得
    const remotes = await git.listRemotes({ fs, dir });
    const remoteInfo = remotes.find(r => r.remote === remote);
    
    if (!remoteInfo) {
      throw new Error(`Remote '${remote}' not found.`);
    }

    const repoInfo = parseGitHubUrl(remoteInfo.url);
    if (!repoInfo) {
      throw new Error('Only GitHub repositories are supported');
    }

    console.log('[git fetch] Repository:', `${repoInfo.owner}/${repoInfo.repo}`);
    console.log('[git fetch] Remote:', remote);

    // 認証ヘッダーを構築
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // fetch実行
    const fetchResult = await git.fetch({
      fs,
      http,
      dir,
      url: remoteInfo.url,
      remote,
      ref: branch,
      depth: depth,
      singleBranch: !!branch,
      tags: tags,
      prune: prune,
      corsProxy: 'https://cors.isomorphic-git.org',
      headers,
      onProgress: (progress) => {
        if (progress.phase === 'Receiving objects') {
          const percent = Math.round((progress.loaded / progress.total) * 100);
          console.log(`[git fetch] ${progress.phase}: ${percent}% (${progress.loaded}/${progress.total})`);
        }
      },
    });

    // フェッチ結果を整形
    let result = `From ${remoteInfo.url}\n`;
    
    if (fetchResult.fetchHead) {
      result += ` * branch            ${branch || 'HEAD'}       -> FETCH_HEAD\n`;
    }

    if (fetchResult.pruned && fetchResult.pruned.length > 0) {
      result += `\nPruned references:\n`;
      fetchResult.pruned.forEach(ref => {
        result += ` - ${ref}\n`;
      });
    }

    console.log('[git fetch] Fetch completed successfully');
    return result.trim() || 'Fetch completed successfully';
  } catch (error: any) {
    console.error('[git fetch] Error:', error);
    throw new Error(`Fetch failed: ${error.message}`);
  }
}

/**
 * git fetch --all - 全リモートをフェッチ
 */
export async function fetchAll(fs: FS, dir: string, options: Omit<FetchOptions, 'remote'> = {}): Promise<string> {
  const remotes = await git.listRemotes({ fs, dir });
  
  if (remotes.length === 0) {
    return 'No remotes configured.';
  }

  const results: string[] = [];
  
  for (const remote of remotes) {
    try {
      const result = await fetch(fs, dir, { ...options, remote: remote.remote });
      results.push(result);
    } catch (error) {
      results.push(`Failed to fetch ${remote.remote}: ${(error as Error).message}`);
    }
  }

  return results.join('\n\n');
}

/**
 * リモートブランチ一覧を取得
 */
export async function listRemoteBranches(fs: FS, dir: string, remote = 'origin'): Promise<string[]> {
  try {
    const branches = await git.listBranches({ fs, dir, remote });
    return branches;
  } catch (error) {
    console.error('[git fetch] Failed to list remote branches:', error);
    return [];
  }
}

/**
 * リモートタグ一覧を取得
 */
export async function listRemoteTags(fs: FS, dir: string): Promise<string[]> {
  try {
    const tags = await git.listTags({ fs, dir });
    return tags;
  } catch (error) {
    console.error('[git fetch] Failed to list remote tags:', error);
    return [];
  }
}
