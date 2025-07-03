import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import { GitFileSystemHelper } from './fileSystemHelper';

/**
 * Git log操作を管理するクラス
 */
export class GitLogOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  // プロジェクトディレクトリの存在を確認し、なければ作成
  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

  // git log - ログ表示
  async log(depth = 10): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      const commits = await git.log({ fs: this.fs, dir: this.dir, depth });
      
      if (commits.length === 0) {
        return 'No commits yet';
      }

      return commits.map(commit => {
        const date = new Date(commit.commit.author.timestamp * 1000);
        return `commit ${commit.oid}\n` +
               `Author: ${commit.commit.author.name} <${commit.commit.author.email}>\n` +
               `Date: ${date.toISOString()}\n\n` +
               `    ${commit.commit.message}\n`;
      }).join('\n');
    } catch (error) {
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }

  // UI用のGitログを取得（パイプ区切り形式、ブランチ情報付き）
  async getFormattedLog(depth = 20): Promise<string> {
    try {
      await this.ensureProjectDirectory();
      console.log('Getting formatted log for dir:', this.dir);
      
      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
        console.log('.git directory exists');
      } catch {
        console.log('.git directory does not exist');
        throw new Error('not a git repository (or any of the parent directories): .git');
      }
      
      // 現在のブランチを取得
      const currentBranch = await git.currentBranch({ fs: this.fs, dir: this.dir }) || 'main';
      
      // 全てのブランチを取得
      const branches = await git.listBranches({ fs: this.fs, dir: this.dir });
      console.log('All branches:', branches);
      
      // 全ブランチからコミットを収集
      const allCommits = new Map<string, any>(); // コミットハッシュをキーとして重複を避ける
      
      for (const branch of branches) {
        try {
          console.log(`Getting commits for branch: ${branch}`);
          const branchCommits = await git.log({ 
            fs: this.fs, 
            dir: this.dir, 
            ref: branch,
            depth: depth
          });
          
          // 各コミットにブランチ情報を付与して追加
          for (const commit of branchCommits) {
            if (!allCommits.has(commit.oid)) {
              // 新しいコミット：そのまま追加
              allCommits.set(commit.oid, { ...commit, sourceBranch: branch });
            } else {
              // 重複コミット：どのブランチに属するかをより適切に判定
              const existingCommit = allCommits.get(commit.oid);
              
              // 1. 現在のブランチを最優先
              if (branch === currentBranch) {
                allCommits.set(commit.oid, { ...commit, sourceBranch: branch });
              } 
              // 2. そのブランチでそのコミットがHEAD（最新）かどうかをチェック
              else if (existingCommit.sourceBranch !== currentBranch) {
                // そのブランチの最新コミットかどうかで判定
                // インデックス0は最新コミット
                const isHeadOfCurrentBranch = branchCommits[0]?.oid === commit.oid;
                const wasHeadOfExistingBranch = existingCommit.isHeadOfBranch;
                
                if (isHeadOfCurrentBranch && !wasHeadOfExistingBranch) {
                  // 現在のブランチのHEADで、既存のブランチのHEADでない場合
                  allCommits.set(commit.oid, { 
                    ...commit, 
                    sourceBranch: branch,
                    isHeadOfBranch: true 
                  });
                } else if (!isHeadOfCurrentBranch && !wasHeadOfExistingBranch) {
                  // どちらもHEADでない場合は、より新しいタイムスタンプを優先
                  if (commit.commit.author.timestamp >= existingCommit.commit.author.timestamp) {
                    allCommits.set(commit.oid, { ...commit, sourceBranch: branch });
                  }
                }
              }
              // 3. 既存が現在のブランチの場合は変更しない
            }
            
            // 最初に追加する時にHEAD情報も記録
            if (!allCommits.get(commit.oid)?.hasOwnProperty('isHeadOfBranch')) {
              const isHead = branchCommits[0]?.oid === commit.oid;
              const currentCommit = allCommits.get(commit.oid);
              allCommits.set(commit.oid, { 
                ...currentCommit, 
                isHeadOfBranch: isHead 
              });
            }
          }
        } catch (branchError) {
          console.warn(`Failed to get commits for branch ${branch}:`, branchError);
        }
      }
      
      // 全コミットを時系列順でソート
      const commits = Array.from(allCommits.values())
        .sort((a, b) => b.commit.author.timestamp - a.commit.author.timestamp);
      
      console.log(`Total unique commits found: ${commits.length}`);
      
      if (commits.length === 0) {
        console.log('No commits found');
        return '';
      }

      const formattedCommits = [];
      
      for (const commit of commits) {
        const date = new Date(commit.commit.author.timestamp * 1000);
        // パイプ文字がメッセージに含まれている場合は置き換える
        const safeMessage = (commit.commit.message || 'No message').replace(/\|/g, '｜').replace(/\n/g, ' ');
        const safeName = (commit.commit.author.name || 'Unknown').replace(/\|/g, '｜');
        const safeDate = date.toISOString();
        // 親コミットのハッシュを追加（複数の親がある場合はカンマ区切り）
        const parentHashes = commit.commit.parent.join(',');
        
        // ソースブランチを使用
        const commitBranch = commit.sourceBranch || currentBranch;
        
        // フォーマット: hash|message|author|date|parentHashes|branch
        const formatted = `${commit.oid}|${safeMessage}|${safeName}|${safeDate}|${parentHashes}|${commitBranch}`;
        formattedCommits.push(formatted);
      }
      
      return formattedCommits.join('\n');
    } catch (error) {
      // Gitリポジトリが初期化されていない場合は空文字を返す
      if (error instanceof Error && error.message.includes('not a git repository')) {
        return '';
      }
      throw new Error(`git log failed: ${(error as Error).message}`);
    }
  }
}
