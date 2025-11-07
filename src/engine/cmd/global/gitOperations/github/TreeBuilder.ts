/**
 * Git Tree Builder
 * ローカルのGitツリーをGitHub上に再構築する
 */

import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import { GitHubAPI, GitTreeEntry } from './GitHubAPI';

export class TreeBuilder {
  private fs: FS;
  private dir: string;
  private githubAPI: GitHubAPI;
  private blobCache: Map<string, string> = new Map(); // content -> sha
  private remoteBlobCache: Set<string> = new Set(); // リモートに既に存在するblob sha

  constructor(fs: FS, dir: string, githubAPI: GitHubAPI) {
    this.fs = fs;
    this.dir = dir;
    this.githubAPI = githubAPI;
  }

  /**
   * コミットのツリーをGitHub上に構築
   */
  async buildTree(commitOid: string, remoteTreeSha?: string): Promise<string> {
    const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: commitOid });
    const treeOid = commit.commit.tree;

    if (remoteTreeSha) {
      try {
        await this.cacheRemoteBlobs(remoteTreeSha);
        const treeSha = await this.buildTreeDifferential(treeOid, remoteTreeSha, '');
        return treeSha;
      } catch (error) {
        console.warn('[TreeBuilder] Differential upload failed, falling back:', error);
      }
    }

    return await this.buildTreeRecursive(treeOid, '');
  }

  /**
   * リモートツリーからblobをキャッシュに追加
   */
  private async cacheRemoteBlobs(treeSha: string): Promise<void> {
    try {
      const tree = await this.githubAPI.getTree(treeSha, true);
      for (const entry of tree.tree) {
        if (entry.type === 'blob' && entry.sha) {
          this.remoteBlobCache.add(entry.sha);
        }
      }
    } catch (error) {
      console.warn('[TreeBuilder] Failed to cache remote blobs:', error);
    }
  }

  /**
   * 差分ベースのツリー構築
   */
  private async buildTreeDifferential(
    localTreeOid: string,
    remoteTreeSha: string,
    path: string
  ): Promise<string> {
    const localTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: localTreeOid });

    let remoteTree;
    try {
      remoteTree = await this.githubAPI.getTree(remoteTreeSha, false);
    } catch (error: any) {
      if (error.message.includes('409') || error.message.includes('empty')) {
        return this.buildTreeRecursive(localTreeOid, path);
      }
      throw error;
    }

    // リモートのファイルマップを作成
    const remoteEntries = new Map<string, (typeof remoteTree.tree)[0]>();
    for (const entry of remoteTree.tree) {
      remoteEntries.set(entry.path, entry);
    }

    const changedEntries: GitTreeEntry[] = [];
    let hasChanges = false;

    // 各エントリを処理（並列化）
    const blobPromises: Promise<{ path: string; mode: string; sha: string } | null>[] = [];
    const treePromises: Promise<{ path: string; mode: string; sha: string } | null>[] = [];

    for (const localEntry of localTree.tree) {
      const remoteEntry = remoteEntries.get(localEntry.path);

      if (localEntry.type === 'blob') {
        // Blobの場合: SHAが異なる場合のみアップロード
        if (!remoteEntry || remoteEntry.sha !== localEntry.oid) {
          hasChanges = true;
          blobPromises.push(
            this.uploadBlob(localEntry.oid, path ? `${path}/${localEntry.path}` : localEntry.path)
              .then(sha => ({
                path: localEntry.path,
                mode: localEntry.mode,
                sha,
              }))
              .catch(err => {
                console.error(`Failed to upload blob ${localEntry.path}:`, err);
                return null;
              })
          );
        } else {
          // 変更なし - リモートのSHAを再利用
          changedEntries.push({
            path: localEntry.path,
            mode: localEntry.mode,
            type: 'blob',
            sha: remoteEntry.sha,
          });
        }
      } else if (localEntry.type === 'tree') {
        // サブツリーの場合
        const remoteSubtreeSha = remoteEntry?.type === 'tree' ? remoteEntry.sha : undefined;

        if (!remoteSubtreeSha || !remoteEntry || remoteEntry.sha !== localEntry.oid) {
          hasChanges = true;
          treePromises.push(
            (remoteSubtreeSha
              ? this.buildTreeDifferential(
                localEntry.oid,
                remoteSubtreeSha,
                path ? `${path}/${localEntry.path}` : localEntry.path
              )
              : this.buildTreeRecursive(
                localEntry.oid,
                path ? `${path}/${localEntry.path}` : localEntry.path
              )
            )
              .then(sha => ({
                path: localEntry.path,
                mode: localEntry.mode,
                sha,
              }))
              .catch(err => {
                console.error(`Failed to build subtree ${localEntry.path}:`, err);
                return null;
              })
          );
        } else {
          // 変更なし - リモートのSHAを再利用
          changedEntries.push({
            path: localEntry.path,
            mode: localEntry.mode,
            type: 'tree',
            sha: remoteEntry.sha!,
          });
        }
      }
    }

    // 並列処理実行
    const BATCH_SIZE = 10;
    for (let i = 0; i < blobPromises.length; i += BATCH_SIZE) {
      const batch = blobPromises.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch);
      for (const result of results) {
        if (result) {
          changedEntries.push({
            path: result.path,
            mode: result.mode,
            type: 'blob',
            sha: result.sha,
          });
        }
      }
    }

    const treeResults = await Promise.all(treePromises);
    for (const result of treeResults) {
      if (result) {
        changedEntries.push({
          path: result.path,
          mode: result.mode,
          type: 'tree',
          sha: result.sha,
        });
      }
    }

    // 削除されたファイルをチェック
    // GitHub APIのbase_treeを使う場合、削除はエントリを含めないことで表現できますが
    // 明示的に削除を指示するには、pathを含めてshaをnullにすることで削除を表現できます。
    // ここでは、リモートに存在してローカルに存在しないエントリをsha:nullとして追加します。
    for (const [remotePath, remoteEntry] of remoteEntries) {
      const localEntry = localTree.tree.find(e => e.path === remotePath);
      if (!localEntry) {
        // リモートにあるがローカルにないファイル（削除された）
        hasChanges = true;
        changedEntries.push({
          path: remotePath,
          mode: remoteEntry.mode,
          type: remoteEntry.type as 'blob' | 'tree',
          sha: null,
        });
      }
    }

    // If nothing changed and the number of entries matches, reuse remote tree
    if (!hasChanges && changedEntries.length === remoteTree.tree.length) {
      return remoteTreeSha;
    }

    // createTree with baseTree will apply additions/updates and deletions (sha:null)
    const treeData = await this.githubAPI.createTree(changedEntries, remoteTreeSha);
    return treeData.sha;
  }

  /**
   * ツリーを再帰的に構築
   */
  private async buildTreeRecursive(treeOid: string, path: string): Promise<string> {
    const tree = await git.readTree({ fs: this.fs, dir: this.dir, oid: treeOid });

    const entries: GitTreeEntry[] = [];

    // Blob処理とサブツリー処理を並列化
    const blobPromises: Promise<{ entry: (typeof tree.tree)[0]; sha: string }>[] = [];
    const treePromises: Promise<{ entry: (typeof tree.tree)[0]; sha: string }>[] = [];

    // 各エントリを処理（並列化）
    for (const entry of tree.tree) {
      const fullPath = path ? `${path}/${entry.path}` : entry.path;

      if (entry.type === 'blob') {
        // Blobの場合は並列でアップロード
        blobPromises.push(this.uploadBlob(entry.oid, fullPath).then(sha => ({ entry, sha })));
      } else if (entry.type === 'tree') {
        // サブツリーも並列で構築
        treePromises.push(
          this.buildTreeRecursive(entry.oid, fullPath).then(sha => ({ entry, sha }))
        );
      }
    }

    // 全Blobを並列処理（バッチサイズで制限）
    const BATCH_SIZE = 10; // GitHub API Rate Limitを考慮
    const blobResults: { entry: (typeof tree.tree)[0]; sha: string }[] = [];
    for (let i = 0; i < blobPromises.length; i += BATCH_SIZE) {
      const batch = blobPromises.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch);
      blobResults.push(...results);
    }

    // サブツリーも並列処理
    const treeResults = await Promise.all(treePromises);

    // エントリを構築
    for (const { entry, sha } of blobResults) {
      entries.push({
        path: entry.path,
        mode: entry.mode,
        type: 'blob',
        sha,
      });
    }

    for (const { entry, sha } of treeResults) {
      entries.push({
        path: entry.path,
        mode: entry.mode,
        type: 'tree',
        sha,
      });
    }

    const treeData = await this.githubAPI.createTree(entries);
    return treeData.sha;
  }

  /**
   * Blobをアップロード
   */
  private async uploadBlob(blobOid: string, path: string): Promise<string> {
    if (this.remoteBlobCache.has(blobOid)) {
      return blobOid;
    }

    // Blobの内容を読み込み
    const blobData = await git.readBlob({
      fs: this.fs,
      dir: this.dir,
      oid: blobOid,
    });

    // バイナリかテキストかを判定
    const content = blobData.blob;
    const isBinary = this.isBinaryContent(content);

    let contentStr: string;
    let encoding: 'utf-8' | 'base64';

    if (isBinary) {
      // バイナリファイルはBase64エンコード
      contentStr = this.arrayBufferToBase64(content);
      encoding = 'base64';
    } else {
      // テキストファイルはUTF-8
      contentStr = new TextDecoder().decode(content);
      encoding = 'utf-8';
    }

    const cacheKey = `${contentStr}:${encoding}`;
    if (this.blobCache.has(cacheKey)) {
      return this.blobCache.get(cacheKey)!;
    }

    const blobData2 = await this.githubAPI.createBlob(contentStr, encoding);
    this.blobCache.set(cacheKey, blobData2.sha);
    this.remoteBlobCache.add(blobData2.sha);

    return blobData2.sha;
  }

  /**
   * バイナリコンテンツかどうかを判定
   */
  private isBinaryContent(buffer: Uint8Array): boolean {
    // 最初の8000バイトをチェック
    const sample = buffer.slice(0, 8000);
    for (let i = 0; i < sample.length; i++) {
      const byte = sample[i];
      // NULL文字やその他の制御文字があればバイナリと判定
      if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) {
        return true;
      }
    }
    return false;
  }

  /**
   * ArrayBufferをBase64に変換
   */
  private arrayBufferToBase64(buffer: Uint8Array): string {
    let binary = '';
    const len = buffer.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode(buffer[i]);
    }
    return btoa(binary);
  }
}
