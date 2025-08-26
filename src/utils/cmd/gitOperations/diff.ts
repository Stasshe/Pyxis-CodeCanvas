import FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';
import { GitFileSystemHelper } from './fileSystemHelper';

/**
 * Git diff操作を管理するクラス
 */
export class GitDiffOperations {
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

  // git diff - 変更差分を表示
  async diff(options: { staged?: boolean; filepath?: string; commit1?: string; commit2?: string; branchName?: string } = {}): Promise<string> {
    try {
      await this.ensureProjectDirectory();

      // Gitリポジトリが初期化されているかチェック
      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { staged, filepath, commit1, commit2, branchName } = options;

      if (commit1 && commit2) {
        // 2つのコミット間の差分
        return await this.diffCommits(commit1, commit2, filepath);
      } else if (branchName) {
        // git diff <branch> の場合: 現在のHEADとbranchNameのHEADを比較
        let currentBranch: string = '';
        try {
          const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
          currentBranch = typeof branch === 'string' ? branch : '';
        } catch {}
        if (!currentBranch) currentBranch = 'main';
        const head1 = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/heads/${currentBranch}` });
        const head2 = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: `refs/heads/${branchName}` });
        return await this.diffCommits(head1, head2, filepath);
      } else if (staged) {
        // ステージされた変更の差分
        return await this.diffStaged(filepath);
      } else {
        // ワーキングディレクトリの変更差分
        return await this.diffWorkingDirectory(filepath);
      }
    } catch (error) {
      throw new Error(`git diff failed: ${(error as Error).message}`);
    }
  }

  // ワーキングディレクトリの変更差分
  private async diffWorkingDirectory(filepath?: string): Promise<string> {
    try {
      // HEADの実際のコミットハッシュを取得
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        // HEADが存在しない場合
        headCommitHash = null;
      }

      if (!headCommitHash) {
        return 'No commits yet - cannot show diff';
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const diffs: string[] = [];

      for (const [file, HEAD, workdir, stage] of status) {
        // 特定ファイルが指定されている場合はそのファイルのみ
        if (filepath && file !== filepath) continue;
        
        // 変更されたファイルのみ処理
        if (HEAD === 1 && workdir === 2) {
          try {
            // 変更されたファイル: HEADと現在のワーキングディレクトリを比較
            let headContent = '';
            let workContent = '';
            
            // HEADからの内容
            try {
              const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: headCommitHash, filepath: file });
              headContent = new TextDecoder().decode(blob);
            } catch {
              headContent = '';
            }
            
            // ワーキングディレクトリの内容
            try {
              workContent = await this.fs.promises.readFile(`${this.dir}/${file}`, 'utf8');
            } catch {
              workContent = '';
            }
            
            const diff = this.formatDiff(file, headContent, workContent);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate diff for ${file}:`, error);
          }
        } else if (HEAD === 0 && workdir === 1) {
          // 新規ファイル
          try {
            let workContent = '';
            try {
              workContent = await this.fs.promises.readFile(`${this.dir}/${file}`, 'utf8');
            } catch {
              workContent = '';
            }
            
            const diff = this.formatDiff(file, '', workContent);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate diff for new file ${file}:`, error);
          }
        } else if (HEAD === 1 && workdir === 0) {
          // 削除されたファイル
          try {
            let headContent = '';
            try {
              const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: headCommitHash, filepath: file });
              headContent = new TextDecoder().decode(blob);
            } catch {
              headContent = '';
            }
            
            const diff = this.formatDiff(file, headContent, '');
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate diff for deleted file ${file}:`, error);
          }
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No changes';
    } catch (error) {
      throw new Error(`Failed to get working directory diff: ${(error as Error).message}`);
    }
  }

  // ステージされた変更の差分
  private async diffStaged(filepath?: string): Promise<string> {
    try {
      // HEADの実際のコミットハッシュを取得
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        // HEADが存在しない場合
        headCommitHash = null;
      }

      if (!headCommitHash) {
        return 'No commits yet - cannot show staged diff';
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const diffs: string[] = [];

      for (const [file, HEAD, workdir, stage] of status) {
        // 特定ファイルが指定されている場合はそのファイルのみ
        if (filepath && file !== filepath) continue;
        
        // ステージされたファイルのみ処理
        if (stage === 2 || stage === 3) {
          try {
            // ステージされた内容と現在のワーキングディレクトリの差分
            const diff = await this.generateStagedDiff(file, headCommitHash);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate staged diff for ${file}:`, error);
          }
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No staged changes';
    } catch (error) {
      throw new Error(`Failed to get staged diff: ${(error as Error).message}`);
    }
  }

  // 2つのコミット間の差分
  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    try {
      console.log('diffCommits called with:', { commit1, commit2, filepath });
      
      // コミットハッシュを正規化
      let fullCommit1: string;
      let fullCommit2: string;
      
      try {
        fullCommit1 = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commit1 });
        console.log('Expanded commit1:', commit1, '->', fullCommit1);
      } catch (error) {
        throw new Error(`Invalid commit1 '${commit1}': ${(error as Error).message}`);
      }
      
      try {
        fullCommit2 = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commit2 });
        console.log('Expanded commit2:', commit2, '->', fullCommit2);
      } catch (error) {
        throw new Error(`Invalid commit2 '${commit2}': ${(error as Error).message}`);
      }

      // 各コミットの情報を取得
      const commit1Obj = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullCommit1 });
      const commit2Obj = await git.readCommit({ fs: this.fs, dir: this.dir, oid: fullCommit2 });

      const tree1 = await git.readTree({ fs: this.fs, dir: this.dir, oid: commit1Obj.commit.tree });
      const tree2 = await git.readTree({ fs: this.fs, dir: this.dir, oid: commit2Obj.commit.tree });

      const diffs: string[] = [];
      
      // 各ツリーのファイル一覧を取得
      const files1 = await this.getTreeFilePaths(tree1); // commit1 のファイル一覧
      const files2 = await this.getTreeFilePaths(tree2); // commit2 のファイル一覧
      const set1 = new Set(files1);
      const set2 = new Set(files2);

      // 削除ファイル: commit1にあってcommit2にない
      for (const file of files1) {
        if (filepath && file !== filepath) continue;
        if (!set2.has(file)) {
          // 削除されたファイル
          try {
            const diff = await this.generateCommitFileDiff(file, fullCommit1, null);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate commit diff for deleted file ${file}:`, error);
          }
        }
      }

      // 新規ファイル: commit2にあってcommit1にない
      for (const file of files2) {
        if (filepath && file !== filepath) continue;
        if (!set1.has(file)) {
          // 新規ファイル
          try {
            const diff = await this.generateCommitFileDiff(file, null, fullCommit2);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate commit diff for new file ${file}:`, error);
          }
        }
      }

      // 変更ファイル: 両方に存在し内容が違う
      for (const file of files1) {
        if (filepath && file !== filepath) continue;
        if (set2.has(file)) {
          try {
            const diff = await this.generateCommitFileDiff(file, fullCommit1, fullCommit2);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate commit diff for modified file ${file}:`, error);
          }
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No differences between commits';
    } catch (error) {
      console.error('diffCommits error:', error);
      throw new Error(`Failed to diff commits: ${(error as Error).message}`);
    }
  }

  // ツリーからファイルパスを取得（再帰的）
  private async getTreeFilePaths(tree: any, basePath = ''): Promise<string[]> {
    const paths: string[] = [];
    
    for (const entry of tree.tree) {
      const fullPath = basePath ? `${basePath}/${entry.path}` : entry.path;
      
      if (entry.type === 'blob') {
        paths.push(fullPath);
      } else if (entry.type === 'tree') {
        // サブツリーも再帰的に処理
        try {
          const subTree = await git.readTree({ fs: this.fs, dir: this.dir, oid: entry.oid });
          const subPaths = await this.getTreeFilePaths(subTree, fullPath);
          paths.push(...subPaths);
        } catch (error) {
          console.warn(`Failed to read subtree ${fullPath}:`, error);
        }
      }
    }
    
    return paths;
  }

  // ステージされた差分を生成
  private async generateStagedDiff(filepath: string, headCommitHash: string): Promise<string> {
    try {
      // HEADからの内容
      let headContent = '';
      try {
        const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: headCommitHash, filepath });
        headContent = new TextDecoder().decode(blob);
      } catch {
        headContent = '';
      }

      // ワーキングディレクトリの内容
      let workContent = '';
      try {
        workContent = await this.fs.promises.readFile(`${this.dir}/${filepath}`, 'utf8');
      } catch {
        workContent = '';
      }

      // ステージングの状態を確認
      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const fileStatus = status.find(([file]) => file === filepath);
      
      if (!fileStatus) {
        return '';
      }

      const [, HEAD, workdir, stage] = fileStatus;
      
      if (stage === 3) {
        // 新規ファイルがステージされた場合
        return this.formatDiff(filepath, '', workContent);
      } else if (stage === 2) {
        // 変更されたファイルがステージされた場合
        return this.formatDiff(filepath, headContent, workContent);
      }

      return '';
    } catch (error) {
      throw new Error(`Failed to generate staged diff: ${(error as Error).message}`);
    }
  }

  // コミット間のファイル差分を生成
  private async generateCommitFileDiff(filepath: string, commit1: string | null, commit2: string | null): Promise<string> {
    let content1 = '';
    let content2 = '';

    try {
      // commit1がnullの場合（新規ファイル）
      if (!commit1 && commit2) {
        if (commit2) {
          try {
            const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commit2, filepath });
            content2 = new TextDecoder().decode(blob);
          } catch {
            content2 = '';
          }
        }
        return this.formatDiff(filepath, '', content2);
      }
      // commit2がnullの場合（削除ファイル）
      if (commit1 && !commit2) {
        if (commit1) {
          try {
            const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commit1, filepath });
            content1 = new TextDecoder().decode(blob);
          } catch {
            content1 = '';
          }
        }
        return this.formatDiff(filepath, content1, '');
      }
      // 両方に存在する場合
      if (commit1) {
        try {
          const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commit1, filepath });
          content1 = new TextDecoder().decode(blob);
        } catch {
          content1 = '';
        }
      }
      if (commit2) {
        try {
          const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid: commit2, filepath });
          content2 = new TextDecoder().decode(blob);
        } catch {
          content2 = '';
        }
      }
      if (content1 === content2) {
        return '';
      }
      return this.formatDiff(filepath, content1, content2);
    } catch (error) {
      console.warn(`Failed to generate commit file diff for ${filepath}:`, error);
      return '';
    }
  }

  // 差分を見やすい形式でフォーマット
  private formatDiff(filepath: string, oldContent: string, newContent: string): string {
    if (oldContent === newContent) {
      return '';
    }

    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    
    let result = `diff --git a/${filepath} b/${filepath}\n`;
    
    if (oldContent === '') {
      result += `new file mode 100644\n`;
      result += `index 0000000..${this.generateShortHash(newContent)}\n`;
      result += `--- /dev/null\n`;
      result += `+++ b/${filepath}\n`;
      result += `@@ -0,0 +1,${newLines.length} @@\n`;
      newLines.forEach(line => result += `+${line}\n`);
    } else if (newContent === '') {
      result += `deleted file mode 100644\n`;
      result += `index ${this.generateShortHash(oldContent)}..0000000\n`;
      result += `--- a/${filepath}\n`;
      result += `+++ /dev/null\n`;
      result += `@@ -1,${oldLines.length} +0,0 @@\n`;
      oldLines.forEach(line => result += `-${line}\n`);
    } else {
      result += `index ${this.generateShortHash(oldContent)}..${this.generateShortHash(newContent)} 100644\n`;
      result += `--- a/${filepath}\n`;
      result += `+++ b/${filepath}\n`;
      
      // 簡単な差分表示（行単位での比較）
      result += this.generateLineDiff(oldLines, newLines);
    }
    
    return result;
  }

  // 行単位での差分を生成
  private generateLineDiff(oldLines: string[], newLines: string[]): string {
    const maxLines = Math.max(oldLines.length, newLines.length);
    let result = '';
    const diffSections: Array<{start: number, oldCount: number, newCount: number, lines: string[]}> = [];
    let currentSection: {start: number, oldCount: number, newCount: number, lines: string[]} | null = null;
    
    for (let i = 0; i < maxLines; i++) {
      const oldLine = i < oldLines.length ? oldLines[i] : undefined;
      const newLine = i < newLines.length ? newLines[i] : undefined;
      
      if (oldLine !== newLine) {
        // 差分が発見された場合、新しいセクションを開始
        if (!currentSection) {
          currentSection = {
            start: i + 1,
            oldCount: 0,
            newCount: 0,
            lines: []
          };
        }
        
        if (oldLine !== undefined && newLine !== undefined) {
          // 変更された行
          currentSection.lines.push(`-${oldLine}`);
          currentSection.lines.push(`+${newLine}`);
          currentSection.oldCount++;
          currentSection.newCount++;
        } else if (oldLine !== undefined) {
          // 削除された行
          currentSection.lines.push(`-${oldLine}`);
          currentSection.oldCount++;
        } else if (newLine !== undefined) {
          // 追加された行
          currentSection.lines.push(`+${newLine}`);
          currentSection.newCount++;
        }
      } else if (currentSection) {
        // 差分がないが、現在のセクションに含める（コンテキスト）
        if (oldLine !== undefined) {
          currentSection.lines.push(` ${oldLine}`);
        }
        
        // セクションが長くなりすぎた場合は終了
        if (currentSection.lines.length > 10) {
          diffSections.push(currentSection);
          currentSection = null;
        }
      }
    }
    
    // 最後のセクションを追加
    if (currentSection) {
      diffSections.push(currentSection);
    }
    
    // セクションが空の場合は簡単な差分表示
    if (diffSections.length === 0) {
      result += `@@ -1,${oldLines.length} +1,${newLines.length} @@\n`;
      const maxLines = Math.max(oldLines.length, newLines.length);
      for (let i = 0; i < maxLines; i++) {
        if (i < oldLines.length && i < newLines.length) {
          if (oldLines[i] !== newLines[i]) {
            result += `-${oldLines[i]}\n`;
            result += `+${newLines[i]}\n`;
          } else {
            result += ` ${oldLines[i]}\n`;
          }
        } else if (i < oldLines.length) {
          result += `-${oldLines[i]}\n`;
        } else if (i < newLines.length) {
          result += `+${newLines[i]}\n`;
        }
      }
    } else {
      // 各セクションを出力
      diffSections.forEach(section => {
        result += `@@ -${section.start},${section.oldCount} +${section.start},${section.newCount} @@\n`;
        result += section.lines.join('\n') + '\n';
      });
    }
    
    return result;
  }

  // 内容から短いハッシュを生成（簡略化）
  private generateShortHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return Math.abs(hash).toString(16).substring(0, 7);
  }
}
