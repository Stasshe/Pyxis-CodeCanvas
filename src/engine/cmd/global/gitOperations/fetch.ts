import git from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { rejectGitAuthentication, validateRemoteUrl } from './transport';

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
    const remotes = await git.listRemotes({ fs, dir });
    const remoteInfo = remotes.find(r => r.remote === remote);

    if (!remoteInfo) {
      throw new Error(`Remote '${remote}' not found.`);
    }

    validateRemoteUrl(remoteInfo.url);
    console.log('[git fetch] Remote:', remote);

    let targetBranch = branch;
    if (!targetBranch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (currentBranch) targetBranch = currentBranch;
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
        onAuth: rejectGitAuthentication,
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
  const errors: string[] = [];

  for (const remote of remotes) {
    try {
      const result = await fetch(fs, dir, { ...options, remote: remote.remote });
      results.push(result);
    } catch (error) {
      errors.push(`Failed to fetch ${remote.remote}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) throw new Error(errors.join('\n'));
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
  return git.listBranches({ fs, dir, remote });
}

export async function listRemoteTags(fs: FS, dir: string): Promise<string[]> {
  return git.listTags({ fs, dir });
}
