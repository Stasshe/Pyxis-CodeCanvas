import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';
import { GitHubAPI, GitHubAPIError, type GitUser } from './github/GitHubAPI';
import { parseGitHubUrl } from './github/repositoryUrl';
import { TreeBuilder } from './github/TreeBuilder';

export interface PushOptions {
  remote?: string;
  branch?: string;
  force?: boolean;
}

function commitIdentity(person: {
  name: string;
  email: string;
  timestamp: number;
  timezoneOffset: number;
}): GitUser {
  const offset = Math.abs(person.timezoneOffset);
  let sign = '-';
  if (person.timezoneOffset < 0 || Object.is(person.timezoneOffset, 0)) sign = '+';
  const hours = String(Math.floor(offset / 60)).padStart(2, '0');
  const minutes = String(offset % 60).padStart(2, '0');
  const localDate = new Date(person.timestamp * 1000 - person.timezoneOffset * 60000)
    .toISOString()
    .slice(0, 19);
  return { name: person.name, email: person.email, date: `${localDate}${sign}${hours}:${minutes}` };
}

export async function push(
  fs: FS,
  dir: string,
  options: PushOptions = {},
  progress?: (message: string) => void
): Promise<string> {
  const { remote = 'origin', force = false } = options;
  try {
    progress?.('Enumerating objects...');
    const token = (await fs.credentials())?.password;
    if (!token) throw new Error('GitHub authentication required. Please sign in first.');
    let branch = options.branch;
    if (!branch) {
      const currentBranch = await git.currentBranch({ fs, dir });
      if (currentBranch) branch = currentBranch;
    }
    if (!branch) throw new Error('No branch checked out');
    const localHead = await git.resolveRef({ fs, dir, ref: `refs/heads/${branch}` });
    const remotes = await git.listRemotes({ fs, dir });
    const remoteInfo = remotes.find(entry => entry.remote === remote);
    if (!remoteInfo) throw new Error(`Remote '${remote}' not found.`);
    const repository = parseGitHubUrl(remoteInfo.url);
    if (!repository) throw new Error('Only GitHub repositories are supported');
    const api = new GitHubAPI(token, repository.owner, repository.repo);
    const remoteRef = await api.getRef(branch);
    const remoteHead = remoteRef?.object.sha;
    if (remoteHead === localHead) return 'Everything up-to-date';
    if (remoteHead && !force) {
      const descendant = await git.isDescendent({ fs, dir, oid: localHead, ancestor: remoteHead });
      if (!descendant)
        throw new Error(
          'Updates were rejected because the remote contains work that you do not have locally. Integrate the remote changes before pushing again.'
        );
    }
    if (!remoteHead) {
      const defaultBranch = await api.getDefaultBranch();
      if (!(await api.getRef(defaultBranch)))
        throw new Error('Remote repository is empty. Initialize it on GitHub before pushing.');
    }

    const uploaded = new Set<string>();
    const commitTrees = new Map<string, string>();
    const builder = new TreeBuilder(fs, dir, api);
    async function upload(oid: string): Promise<void> {
      if (uploaded.has(oid)) return;
      try {
        const existing = await api.getCommit(oid);
        if (existing.sha !== oid) throw new Error(`Remote commit identity differs for ${oid}`);
        uploaded.add(oid);
        commitTrees.set(oid, existing.tree.sha);
        return;
      } catch (error) {
        if (!(error instanceof GitHubAPIError) || error.status !== 404) throw error;
      }
      const { commit } = await git.readCommit({ fs, dir, oid });
      for (const parent of commit.parent) await upload(parent);
      const tree = await builder.buildTree(oid, commitTrees.get(commit.parent[0]));
      if (tree !== commit.tree)
        throw new Error(`GitHub tree identity differs for ${oid}; refs were not updated`);
      progress?.(`Uploading commit ${oid.slice(0, 7)}`);
      const created = await api.createCommit({
        tree,
        parents: commit.parent,
        message: commit.message,
        author: commitIdentity(commit.author),
        committer: commitIdentity(commit.committer),
        signature: commit.gpgsig,
      });
      if (created.sha !== oid)
        throw new Error(`GitHub commit identity differs for ${oid}; refs were not updated`);
      uploaded.add(oid);
      commitTrees.set(oid, tree);
    }
    await upload(localHead);
    if (remoteHead) await api.updateRef(branch, localHead, force);
    else await api.createRef(branch, localHead);
    await git.writeRef({
      fs,
      dir,
      ref: `refs/remotes/${remote}/${branch}`,
      value: localHead,
      force: true,
    });
    if (!remoteHead) return `To ${remoteInfo.url}\n * [new branch]      ${branch} -> ${branch}\n`;
    return `To ${remoteInfo.url}\n   ${remoteHead.slice(0, 7)}..${localHead.slice(0, 7)}  ${branch} -> ${branch}\n`;
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    throw new Error(`Push failed: ${message}`);
  }
}

export async function addRemote(fs: FS, dir: string, remote: string, url: string): Promise<string> {
  await git.addRemote({ fs, dir, remote, url });
  return `Remote '${remote}' added: ${url}`;
}

export async function listRemotes(fs: FS, dir: string): Promise<string> {
  const remotes = await git.listRemotes({ fs, dir });
  if (remotes.length === 0) return 'No remotes configured.';
  return remotes.map((r: { remote: string; url: string }) => `${r.remote}\t${r.url}`).join('\n');
}

export async function deleteRemote(fs: FS, dir: string, remote: string): Promise<string> {
  await git.deleteRemote({ fs, dir, remote });
  return `Remote '${remote}' deleted.`;
}
