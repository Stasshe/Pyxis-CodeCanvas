/**
 * Git Tree Builder
 * ローカルのGitツリーをGitHub上に再構築する
 */

import git from 'isomorphic-git';
import FS from '@isomorphic-git/lightning-fs';
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
   * コミットのツリーをGitHub上に構築（vscode.dev方式: 差分ベース）
   */
  async buildTree(commitOid: string, remoteTreeSha?: string): Promise<string> {
    console.log('[TreeBuilder] Building tree for commit:', commitOid);

    // コミットオブジェクトを取得
    const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: commitOid });
    const treeOid = commit.commit.tree;

    // リモートツリーがあれば、base_treeを使用して差分のみ送信（vscode.dev方式）
    if (remoteTreeSha) {
      try {
        console.log('[TreeBuilder] Using base tree for differential upload:', remoteTreeSha);
        await this.cacheRemoteBlobs(remoteTreeSha);
        
        // 差分のみをアップロード（最速）
        const treeSha = await this.buildTreeDifferential(treeOid, remoteTreeSha, '');
        console.log('[TreeBuilder] Tree built (differential):', treeSha);
        return treeSha;
      } catch (error) {
        console.warn('[TreeBuilder] Differential upload failed, falling back to full upload:', error);
        // フォールバック: 全体アップロード
      }
    }

    // リモートツリーがない場合、または差分アップロードに失敗した場合は全体を構築
    const treeSha = await this.buildTreeRecursive(treeOid, '');
    console.log('[TreeBuilder] Tree built successfully:', treeSha);
    return treeSha;
  }

  /**
   * リモートツリーからblobをキャッシュに追加
   */
  private async cacheRemoteBlobs(treeSha: string): Promise<void> {
    try {
      const tree = await this.githubAPI.getTree(treeSha, true); // recursive=true
      for (const entry of tree.tree) {
        if (entry.type === 'blob' && entry.sha) {
          this.remoteBlobCache.add(entry.sha);
        }
      }
      console.log(`[TreeBuilder] Cached ${this.remoteBlobCache.size} remote blobs`);
    } catch (error) {
      console.warn('[TreeBuilder] Failed to get remote tree:', error);
    }
  }

  /**
   * 差分ベースのツリー構築（vscode.dev方式: base_treeを使用）
   * これが最も高速 - 変更されたファイルのみアップロード
   */
  private async buildTreeDifferential(
    localTreeOid: string,
    remoteTreeSha: string,
    path: string
  ): Promise<string> {
    console.log('[TreeBuilder] Building differential tree:', path || 'root');

    // ローカルのツリーオブジェクトを読み込み
    const localTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: localTreeOid });

    // リモートツリーを取得
    const remoteTree = await this.githubAPI.getTree(remoteTreeSha, false);
    
    // リモートのファイルマップを作成
    const remoteEntries = new Map<string, typeof remoteTree.tree[0]>();
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
              ? this.buildTreeDifferential(localEntry.oid, remoteSubtreeSha, path ? `${path}/${localEntry.path}` : localEntry.path)
              : this.buildTreeRecursive(localEntry.oid, path ? `${path}/${localEntry.path}` : localEntry.path)
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
    for (const [remotePath, remoteEntry] of remoteEntries) {
      const localEntry = localTree.tree.find(e => e.path === remotePath);
      if (!localEntry) {
        // リモートにあるがローカルにないファイル（削除された）
        hasChanges = true;
        // GitHub APIのbase_tree方式では、削除はエントリを含めないことで表現される
      }
    }

    // 変更がない場合はリモートのツリーを再利用
    if (!hasChanges && changedEntries.length === remoteTree.tree.length) {
      console.log('[TreeBuilder] No changes, reusing remote tree:', remoteTreeSha);
      return remoteTreeSha;
    }

    // 変更がある場合のみ新しいツリーを作成
    const treeData = await this.githubAPI.createTree(changedEntries, remoteTreeSha);
    console.log('[TreeBuilder] Created differential tree:', path || 'root', '->', treeData.sha);
    return treeData.sha;
  }

  /**
   * ツリーを再帰的に構築（並列処理最適化版）
   */
  private async buildTreeRecursive(treeOid: string, path: string): Promise<string> {
    console.log('[TreeBuilder] Building tree:', path || 'root');

    // ローカルのツリーオブジェクトを読み込み
    const tree = await git.readTree({ fs: this.fs, dir: this.dir, oid: treeOid });

    const entries: GitTreeEntry[] = [];

    // Blob処理とサブツリー処理を並列化
    const blobPromises: Promise<{ entry: typeof tree.tree[0]; sha: string }>[] = [];
    const treePromises: Promise<{ entry: typeof tree.tree[0]; sha: string }>[] = [];

    // 各エントリを処理（並列化）
    for (const entry of tree.tree) {
      const fullPath = path ? `${path}/${entry.path}` : entry.path;

      if (entry.type === 'blob') {
        // Blobの場合は並列でアップロード
        blobPromises.push(
          this.uploadBlob(entry.oid, fullPath).then(sha => ({ entry, sha }))
        );
      } else if (entry.type === 'tree') {
        // サブツリーも並列で構築
        treePromises.push(
          this.buildTreeRecursive(entry.oid, fullPath).then(sha => ({ entry, sha }))
        );
      }
    }

    // 全Blobを並列処理（バッチサイズで制限）
    const BATCH_SIZE = 10; // GitHub API Rate Limitを考慮
    const blobResults: { entry: typeof tree.tree[0]; sha: string }[] = [];
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

    // ツリーをGitHub上に作成
    const treeData = await this.githubAPI.createTree(entries);
    console.log('[TreeBuilder] Created tree:', path || 'root', '->', treeData.sha);

    return treeData.sha;
  }

  /**
   * Blobをアップロード（既存blob確認最適化版）
   */
  private async uploadBlob(blobOid: string, path: string): Promise<string> {
    // リモートに既に存在する場合はスキップ（最大の最適化）
    if (this.remoteBlobCache.has(blobOid)) {
      console.log('[TreeBuilder] Blob already on remote (skipped):', path, '->', blobOid);
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

    // キャッシュチェック
    const cacheKey = `${contentStr}:${encoding}`;
    if (this.blobCache.has(cacheKey)) {
      const cachedSha = this.blobCache.get(cacheKey)!;
      console.log('[TreeBuilder] Blob cache hit:', path, '->', cachedSha);
      return cachedSha;
    }

    // GitHub上にBlobを作成
    const blobData2 = await this.githubAPI.createBlob(contentStr, encoding);
    console.log('[TreeBuilder] Uploaded blob:', path, '->', blobData2.sha);

    // キャッシュに保存
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
