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

  constructor(fs: FS, dir: string, githubAPI: GitHubAPI) {
    this.fs = fs;
    this.dir = dir;
    this.githubAPI = githubAPI;
  }

  /**
   * コミットのツリーをGitHub上に構築
   */
  async buildTree(commitOid: string): Promise<string> {
    console.log('[TreeBuilder] Building tree for commit:', commitOid);

    // コミットオブジェクトを取得
    const commit = await git.readCommit({ fs: this.fs, dir: this.dir, oid: commitOid });
    const treeOid = commit.commit.tree;

    // ルートツリーを構築
    const treeSha = await this.buildTreeRecursive(treeOid, '');

    console.log('[TreeBuilder] Tree built successfully:', treeSha);
    return treeSha;
  }

  /**
   * ツリーを再帰的に構築
   */
  private async buildTreeRecursive(treeOid: string, path: string): Promise<string> {
    console.log('[TreeBuilder] Building tree:', path || 'root');

    // ローカルのツリーオブジェクトを読み込み
    const tree = await git.readTree({ fs: this.fs, dir: this.dir, oid: treeOid });

    const entries: GitTreeEntry[] = [];

    // 各エントリを処理
    for (const entry of tree.tree) {
      const fullPath = path ? `${path}/${entry.path}` : entry.path;

      if (entry.type === 'blob') {
        // Blobの場合
        const blobSha = await this.uploadBlob(entry.oid, fullPath);
        entries.push({
          path: entry.path,
          mode: entry.mode,
          type: 'blob',
          sha: blobSha,
        });
      } else if (entry.type === 'tree') {
        // サブツリーの場合、再帰的に構築
        const subtreeSha = await this.buildTreeRecursive(entry.oid, fullPath);
        entries.push({
          path: entry.path,
          mode: entry.mode,
          type: 'tree',
          sha: subtreeSha,
        });
      }
    }

    // ツリーをGitHub上に作成
    const treeData = await this.githubAPI.createTree(entries);
    console.log('[TreeBuilder] Created tree:', path || 'root', '->', treeData.sha);

    return treeData.sha;
  }

  /**
   * Blobをアップロード
   */
  private async uploadBlob(blobOid: string, path: string): Promise<string> {
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
