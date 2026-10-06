import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { parseGitHubUrl } from './github/utils';

export interface FetchOptions {
  remote?: string;
  branch?: string;
  depth?: number;
  prune?: boolean;
  tags?: boolean;
}

export async function fetch(fs: FS, dir: string, options: FetchOptions = {}): Promise<string> {
  const { remote = 'origin', branch, depth, prune = false, tags = false } = options;

  try {
    const token = (await fs.credentials())?.password;

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

    if (!token) {
      throw new Error('GitHub authentication required for fetch');
    }

    const { GitHubAPI } = await import('./github/GitHubAPI');
    const githubAPI = new GitHubAPI(token, repoInfo.owner, repoInfo.repo);

    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      targetBranch = currentBranch || 'main';
    }

    const remoteRef = await githubAPI.getRef(targetBranch);
    if (!remoteRef) {
      console.log('[git fetch] Remote branch does not exist:', targetBranch);
      return `From ${remoteInfo.url}\nRemote branch '${targetBranch}' does not exist yet.\nUse 'git push' to create it.`;
    }

    let fetchResult: Awaited<ReturnType<typeof git.fetch>>;
    try {
      fetchResult = await git.fetch({
        fs,
        http,
        dir,
        url: remoteInfo.url,
        remote,
        ref: targetBranch,
        depth: depth,
        singleBranch: !!branch,
        tags: tags,
        prune: prune,
        corsProxy: 'https://cors.isomorphic-git.org',
        onAuth: () => ({
          username: token,
          password: 'x-oauth-basic',
        }),
        onProgress: progress => {
          if (progress.phase === 'Receiving objects') {
            const percent = Math.round((progress.loaded / progress.total) * 100);
            console.log(
              `[git fetch] ${progress.phase}: ${percent}% (${progress.loaded}/${progress.total})`
            );
          }
        },
      });
    } catch (fetchError) {
      console.error('[git fetch] Fetch failed:', fetchError);
      throw new Error(`Fetch failed: ${String(fetchError)}`);
    }

    let result = `From ${remoteInfo.url}\n`;

    if (fetchResult.fetchHead) {
      result += ` * branch            ${targetBranch}       -> FETCH_HEAD\n`;

      try {
        const remoteTrackingRef = await git.resolveRef({
          fs,
          dir,
          ref: `refs/remotes/${remote}/${targetBranch}`,
        });
        result += ` * [updated]         ${remote}/${targetBranch} -> ${remote}/${targetBranch}\n`;
        console.log(
          `[git fetch] Updated ${remote}/${targetBranch} to ${remoteTrackingRef.slice(0, 7)}`
        );
      } catch {
        console.warn('[git fetch] Could not verify remote tracking branch update');
      }
    }

    if (fetchResult.pruned && fetchResult.pruned.length > 0) {
      result += '\nPruned references:\n';
      fetchResult.pruned.forEach(ref => {
        result += ` - ${ref}\n`;
      });
    }

    console.log('[git fetch] Fetch completed successfully');
    return result.trim() || 'Fetch completed successfully';
  } catch (error) {
    console.error('[git fetch] Error:', error);
    throw new Error(`Fetch failed: ${String(error)}`);
  }
}

export async function fetchAll(
  fs: FS,
  dir: string,
  options: Omit<FetchOptions, 'remote'> = {}
): Promise<string> {
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

import { parseWithGetOpt } from '../../lib';

export async function fetchFromArgs(fs: FS, dir: string, args: string[]): Promise<string> {
  const optstring = 'ad:p';
  const longopts = ['all', 'prune', 'tags', 'depth='];
  const { flags, values, positional, errors } = parseWithGetOpt(args, optstring, longopts);
  if (errors.length) throw new Error(errors.join('; '));

  const all = flags.has('--all') || flags.has('-a');
  const prune = flags.has('--prune') || flags.has('-p');
  const tags = flags.has('--tags');

  const depthVal = values.get('--depth') || values.get('-d');
  let depth: number | undefined;
  if (depthVal !== undefined) depth = Number(depthVal);

  let remote: string | undefined;
  if (positional[0]?.trim()) remote = positional[0];
  let branch: string | undefined;
  if (positional[1]?.trim()) branch = positional[1];

  if (all) {
    return await fetchAll(fs, dir, { depth, prune, tags });
  }

  return await fetch(fs, dir, { remote, branch, depth, prune, tags });
}

export async function listRemoteBranches(
  fs: FS,
  dir: string,
  remote = 'origin'
): Promise<string[]> {
  try {
    const branches = await git.listBranches({ fs, dir, remote });
    return branches;
  } catch (error) {
    console.error('[git fetch] Failed to list remote branches:', error);
    return [];
  }
}

export async function listRemoteTags(fs: FS, dir: string): Promise<string[]> {
  try {
    const tags = await git.listTags({ fs, dir });
    return tags;
  } catch (error) {
    console.error('[git fetch] Failed to list remote tags:', error);
    return [];
  }
}
