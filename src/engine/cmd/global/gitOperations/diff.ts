import type FS from '@isomorphic-git/lightning-fs';
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
    await GitFileSystemHelper.ensureDirectory(this.dir);
  }

  // git diff - 変更差分を表示
  async diff(
    options: {
      staged?: boolean;
      filepath?: string;
      commit1?: string;
      commit2?: string;
      branchName?: string;
    } = {}
  ): Promise<string> {
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
      }
      if (branchName) {
        // git diff <branch> の場合: 現在のHEADとbranchNameのHEADを比較
        let currentBranch = '';
        try {
          const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
          currentBranch = typeof branch === 'string' ? branch : '';
        } catch {}
        if (!currentBranch) currentBranch = 'main';
        const head1 = await git.resolveRef({
          fs: this.fs,
          dir: this.dir,
          ref: `refs/heads/${currentBranch}`,
        });
        const head2 = await git.resolveRef({
          fs: this.fs,
          dir: this.dir,
          ref: `refs/heads/${branchName}`,
        });
        return await this.diffCommits(head1, head2, filepath);
      }
      if (staged) {
        // ステージされた変更の差分
        return await this.diffStaged(filepath);
      }
      // ワーキングディレクトリの変更差分
      return await this.diffWorkingDirectory(filepath);
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

      // If there is no HEAD (no commits yet), continue and attempt to
      // generate diffs from working directory. For new repositories we
      // still want to include new file contents in the diff for commit
      // message generation.
      if (!headCommitHash) {
        console.log(
          '[GitDiffOperations] No HEAD commit found; showing working directory changes (treating missing HEAD as empty)'
        );
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
              if (headCommitHash) {
                const { blob } = await git.readBlob({
                  fs: this.fs,
                  dir: this.dir,
                  oid: headCommitHash,
                  filepath: file,
                });
                headContent = new TextDecoder().decode(blob);
              } else {
                headContent = '';
              }
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
        } else if (HEAD === 0 && (workdir === 1 || workdir === 2)) {
          // 新規ファイル - workdir が 1 または 2 の場合
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
              if (headCommitHash) {
                const { blob } = await git.readBlob({
                  fs: this.fs,
                  dir: this.dir,
                  oid: headCommitHash,
                  filepath: file,
                });
                headContent = new TextDecoder().decode(blob);
              } else {
                headContent = '';
              }
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

  // 2つのコミット間の差分（git.walk APIを使用した高速版）
  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    try {
      // コミットハッシュを正規化
      let fullCommit1: string;
      let fullCommit2: string;

      try {
        fullCommit1 = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commit1 });
      } catch (error) {
        throw new Error(`Invalid commit1 '${commit1}': ${(error as Error).message}`);
      }

      try {
        fullCommit2 = await git.expandOid({ fs: this.fs, dir: this.dir, oid: commit2 });
      } catch (error) {
        throw new Error(`Invalid commit2 '${commit2}': ${(error as Error).message}`);
      }

      // git.walkを使用して両方のツリーを同時に走査し、変更のあるファイルのみを検出
      const changedFiles: Array<{
        path: string;
        type: 'added' | 'deleted' | 'modified';
        oid1?: string;
        oid2?: string;
      }> = [];

      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [git.TREE({ ref: fullCommit1 }), git.TREE({ ref: fullCommit2 })],
        map: async (filepath_walk, [entry1, entry2]) => {
          // ルートディレクトリはスキップ
          if (filepath_walk === '.') return;

          // フィルタが指定されている場合はマッチしないファイルをスキップ
          if (filepath && filepath_walk !== filepath) return;

          // 両方ともディレクトリの場合はスキップ（再帰的に処理される）
          const type1 = entry1 ? await entry1.type() : null;
          const type2 = entry2 ? await entry2.type() : null;

          if (type1 === 'tree' && type2 === 'tree') return;
          if (type1 === 'tree' || type2 === 'tree') return;

          const oid1 = entry1 ? await entry1.oid() : null;
          const oid2 = entry2 ? await entry2.oid() : null;

          // 両方とも同じoid（変更なし）
          if (oid1 === oid2) return;

          if (!oid1 && oid2) {
            // 新規ファイル（commit1になく、commit2にある）
            changedFiles.push({ path: filepath_walk, type: 'added', oid2 });
          } else if (oid1 && !oid2) {
            // 削除ファイル（commit1にあり、commit2にない）
            changedFiles.push({ path: filepath_walk, type: 'deleted', oid1 });
          } else if (oid1 && oid2) {
            // 変更ファイル
            changedFiles.push({ path: filepath_walk, type: 'modified', oid1, oid2 });
          }
        },
      });

      // 変更がない場合
      if (changedFiles.length === 0) {
        return 'No differences between commits';
      }

      // 変更があったファイルのみdiffを生成
      const diffs: string[] = [];

      for (const file of changedFiles) {
        try {
          let content1 = '';
          let content2 = '';

          if (file.oid1) {
            const { blob } = await git.readBlob({
              fs: this.fs,
              dir: this.dir,
              oid: file.oid1,
            });
            content1 = new TextDecoder().decode(blob);
          }

          if (file.oid2) {
            const { blob } = await git.readBlob({
              fs: this.fs,
              dir: this.dir,
              oid: file.oid2,
            });
            content2 = new TextDecoder().decode(blob);
          }

          const diff = this.formatDiff(file.path, content1, content2);
          if (diff) diffs.push(diff);
        } catch (error) {
          console.warn(`Failed to generate diff for ${file.path}:`, error);
        }
      }

      return diffs.length > 0 ? diffs.join('\n\n') : 'No differences between commits';
    } catch (error) {
      console.error('diffCommits error:', error);
      throw new Error(`Failed to diff commits: ${(error as Error).message}`);
    }
  }

  // ステージされた差分を生成
  private async generateStagedDiff(filepath: string, headCommitHash: string): Promise<string> {
    try {
      // HEADからの内容
      let headContent = '';
      try {
        const { blob } = await git.readBlob({
          fs: this.fs,
          dir: this.dir,
          oid: headCommitHash,
          filepath,
        });
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
      }
      if (stage === 2) {
        // 変更されたファイルがステージされた場合
        return this.formatDiff(filepath, headContent, workContent);
      }

      return '';
    } catch (error) {
      throw new Error(`Failed to generate staged diff: ${(error as Error).message}`);
    }
  }

  // コミット間のファイル差分を生成
  private async generateCommitFileDiff(
    filepath: string,
    commit1: string | null,
    commit2: string | null
  ): Promise<string> {
    let content1 = '';
    let content2 = '';

    try {
      // commit1がnullの場合（新規ファイル）
      if (!commit1 && commit2) {
        if (commit2) {
          try {
            const { blob } = await git.readBlob({
              fs: this.fs,
              dir: this.dir,
              oid: commit2,
              filepath,
            });
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
            const { blob } = await git.readBlob({
              fs: this.fs,
              dir: this.dir,
              oid: commit1,
              filepath,
            });
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
          const { blob } = await git.readBlob({
            fs: this.fs,
            dir: this.dir,
            oid: commit1,
            filepath,
          });
          content1 = new TextDecoder().decode(blob);
        } catch {
          content1 = '';
        }
      }
      if (commit2) {
        try {
          const { blob } = await git.readBlob({
            fs: this.fs,
            dir: this.dir,
            oid: commit2,
            filepath,
          });
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
      result += 'new file mode 100644\n';
      result += `index 0000000..${this.generateShortHash(newContent)}\n`;
      result += '--- /dev/null\n';
      result += `+++ b/${filepath}\n`;
      result += `@@ -0,0 +1,${newLines.length} @@\n`;
      newLines.forEach(line => (result += `+${line}\n`));
    } else if (newContent === '') {
      result += 'deleted file mode 100644\n';
      result += `index ${this.generateShortHash(oldContent)}..0000000\n`;
      result += `--- a/${filepath}\n`;
      result += '+++ /dev/null\n';
      result += `@@ -1,${oldLines.length} +0,0 @@\n`;
      oldLines.forEach(line => (result += `-${line}\n`));
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
    const diffSections: Array<{
      start: number;
      oldCount: number;
      newCount: number;
      lines: string[];
    }> = [];
    let currentSection: {
      start: number;
      oldCount: number;
      newCount: number;
      lines: string[];
    } | null = null;

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
            lines: [],
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
        result += `${section.lines.join('\n')}\n`;
      });
    }

    return result;
  }

  // 内容から短いハッシュを生成（簡略化）
  private generateShortHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // 32bit整数に変換
    }
    return Math.abs(hash).toString(16).substring(0, 7);
  }
}
