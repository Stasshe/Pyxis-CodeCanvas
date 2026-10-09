import { Buffer } from 'buffer';
import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';

import type { GitHubAPI, GitTree, GitTreeEntry } from './GitHubAPI';

export class TreeBuilder {
  private fs: FS;
  private dir: string;
  private githubAPI: GitHubAPI;
  private blobCache: Map<string, string> = new Map();
  private remoteBlobCache: Set<string> = new Set();

  constructor(fs: FS, dir: string, githubAPI: GitHubAPI) {
    this.fs = fs;
    this.dir = dir;
    this.githubAPI = githubAPI;
  }

  async buildTree(commitOid: string, remoteTreeSha?: string): Promise<string> {
    const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: commitOid });
    const treeOid = commit.commit.tree;

    if (remoteTreeSha) {
      if (treeOid === remoteTreeSha) return remoteTreeSha;
      if (await this.githubAPI.treeExists(treeOid)) return treeOid;
      await this.cacheRemoteBlobs(remoteTreeSha);
      return this.buildTreeDifferential(treeOid, remoteTreeSha, '');
    }

    return await this.buildTreeRecursive(treeOid, '');
  }

  private async cacheRemoteBlobs(treeSha: string): Promise<void> {
    const tree = await this.githubAPI.getTree(treeSha, true);
    for (const entry of tree.tree) {
      if (entry.type === 'blob' && entry.sha) this.remoteBlobCache.add(entry.sha);
    }
  }

  private async buildTreeDifferential(
    localTreeOid: string,
    remoteTreeSha: string,
    path: string
  ): Promise<string> {
    if (localTreeOid === remoteTreeSha) {
      console.log(`[TreeBuilder] Tree unchanged at ${path || 'root'}:`, remoteTreeSha.slice(0, 7));
      return remoteTreeSha;
    }

    const localTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: localTreeOid });

    let remoteTree: GitTree;
    try {
      remoteTree = await this.githubAPI.getTree(remoteTreeSha, false);
    } catch (error) {
      let message = String(error);
      if (error instanceof Error) message = error.message;
      if (message.includes('409') || message.includes('empty')) {
        return this.buildTreeRecursive(localTreeOid, path);
      }
      throw error;
    }

    const remoteEntries = new Map<string, (typeof remoteTree.tree)[0]>();
    for (const entry of remoteTree.tree) {
      remoteEntries.set(entry.path, entry);
    }

    const changedEntries: GitTreeEntry[] = [];
    let hasChanges = false;

    for (const localEntry of localTree.tree) {
      let fullPath = localEntry.path;
      if (path) fullPath = `${path}/${localEntry.path}`;
      const remoteEntry = remoteEntries.get(localEntry.path);

      if (localEntry.type === 'blob') {
        if (
          !remoteEntry ||
          remoteEntry.type !== localEntry.type ||
          remoteEntry.mode !== localEntry.mode ||
          remoteEntry.sha !== localEntry.oid
        ) {
          hasChanges = true;
          const sha = await this.uploadBlob(localEntry.oid, fullPath);
          changedEntries.push({ path: localEntry.path, mode: localEntry.mode, type: 'blob', sha });
        } else {
          changedEntries.push({
            path: localEntry.path,
            mode: localEntry.mode,
            type: 'blob',
            sha: remoteEntry.sha,
          });
        }
      } else if (localEntry.type === 'tree') {
        let remoteSubtreeSha: string | null | undefined;
        if (remoteEntry?.type === 'tree') remoteSubtreeSha = remoteEntry.sha;

        if (
          !remoteSubtreeSha ||
          !remoteEntry ||
          remoteEntry.type !== localEntry.type ||
          remoteEntry.mode !== localEntry.mode ||
          remoteEntry.sha !== localEntry.oid
        ) {
          hasChanges = true;
          let sha: string;
          if (remoteSubtreeSha) {
            sha = await this.buildTreeDifferential(localEntry.oid, remoteSubtreeSha, fullPath);
          } else {
            sha = await this.buildTreeRecursive(localEntry.oid, fullPath);
          }
          changedEntries.push({ path: localEntry.path, mode: localEntry.mode, type: 'tree', sha });
        } else {
          changedEntries.push({
            path: localEntry.path,
            mode: localEntry.mode,
            type: 'tree',
            sha: remoteEntry.sha ?? '',
          });
        }
      }
    }

    for (const [remotePath, remoteEntry] of remoteEntries) {
      const localEntry = localTree.tree.find((e: { path: string }) => e.path === remotePath);
      if (!localEntry) {
        hasChanges = true;
        changedEntries.push({
          path: remotePath,
          mode: remoteEntry.mode,
          type: remoteEntry.type as 'blob' | 'tree',
          sha: null,
        });
      }
    }

    if (!hasChanges && changedEntries.length === remoteTree.tree.length) {
      return remoteTreeSha;
    }

    const treeData = await this.githubAPI.createTree(changedEntries, remoteTreeSha);
    return treeData.sha;
  }

  private async buildTreeRecursive(treeOid: string, path: string): Promise<string> {
    const tree = await git.readTree({ fs: this.fs, dir: this.dir, oid: treeOid });

    const entries: GitTreeEntry[] = [];

    for (const entry of tree.tree) {
      let fullPath = entry.path;
      if (path) fullPath = `${path}/${entry.path}`;
      let sha: string;
      if (entry.type === 'blob') {
        sha = await this.uploadBlob(entry.oid, fullPath);
      } else if (entry.type === 'tree') {
        sha = await this.buildTreeRecursive(entry.oid, fullPath);
      } else {
        throw new Error(`Unsupported Git entry type at ${fullPath}: ${entry.type}`);
      }
      entries.push({ path: entry.path, mode: entry.mode, type: entry.type, sha });
    }

    const treeData = await this.githubAPI.createTree(entries);
    return treeData.sha;
  }

  private async uploadBlob(blobOid: string, path: string): Promise<string> {
    if (this.remoteBlobCache.has(blobOid)) {
      return blobOid;
    }

    const blobData = await git.readBlob({
      fs: this.fs,
      dir: this.dir,
      oid: blobOid,
    });

    const contentStr = Buffer.from(blobData.blob).toString('base64');
    const encoding = 'base64';

    const cacheKey = `${contentStr}:${encoding}`;
    const cachedValue = this.blobCache.get(cacheKey);
    if (cachedValue) {
      return cachedValue;
    }

    const blobData2 = await this.githubAPI.createBlob(contentStr, encoding);
    this.blobCache.set(cacheKey, blobData2.sha);
    this.remoteBlobCache.add(blobData2.sha);

    return blobData2.sha;
  }
}
