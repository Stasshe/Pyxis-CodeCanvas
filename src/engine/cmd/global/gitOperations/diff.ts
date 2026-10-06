import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';

import { GitFileSystemHelper } from './fileSystemHelper';

export class GitDiffOperations {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  private async ensureProjectDirectory(): Promise<void> {
    await GitFileSystemHelper.ensureDirectory(this.fs, this.dir);
  }

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

      try {
        await this.fs.promises.stat(`${this.dir}/.git`);
      } catch {
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { staged, commit1, commit2, branchName } = options;
      let filepath = options.filepath;
      if (filepath) filepath = repositoryPath(this.dir, filepath);

      if (commit1 && commit2) {
        return await this.diffCommits(commit1, commit2, filepath);
      }
      if (branchName) {
        let currentBranch = '';
        try {
          const branch = await git.currentBranch({ fs: this.fs, dir: this.dir });
          if (typeof branch === 'string') currentBranch = branch;
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
        return await this.diffStaged(filepath);
      }
      return await this.diffWorkingDirectory(filepath);
    } catch (error) {
      throw new Error(`git diff failed: ${(error as Error).message}`);
    }
  }

  private async diffWorkingDirectory(filepath?: string): Promise<string> {
    try {
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        headCommitHash = null;
      }

      if (!headCommitHash) {
        console.log(
          '[GitDiffOperations] No HEAD commit found; showing working directory changes (treating missing HEAD as empty)'
        );
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const diffs: string[] = [];

      for (const [file, HEAD, workdir, _stage] of status) {
        if (filepath && file !== filepath) continue;

        if (HEAD === 1 && workdir === 2) {
          try {
            let headContent = '';
            let workContent = '';

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

      if (diffs.length > 0) return diffs.join('\n\n');
      return 'No changes';
    } catch (error) {
      throw new Error(`Failed to get working directory diff: ${(error as Error).message}`);
    }
  }

  private async diffStaged(filepath?: string): Promise<string> {
    try {
      let headCommitHash: string | null = null;
      try {
        headCommitHash = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
      } catch {
        headCommitHash = null;
      }

      if (!headCommitHash) {
        return 'No commits yet - cannot show staged diff';
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const diffs: string[] = [];

      for (const [file, _HEAD, _workdir, stage] of status) {
        if (filepath && file !== filepath) continue;

        if (stage === 2 || stage === 3) {
          try {
            const diff = await this.generateStagedDiff(file, headCommitHash);
            if (diff) diffs.push(diff);
          } catch (error) {
            console.warn(`Failed to generate staged diff for ${file}:`, error);
          }
        }
      }

      if (diffs.length > 0) return diffs.join('\n\n');
      return 'No staged changes';
    } catch (error) {
      throw new Error(`Failed to get staged diff: ${(error as Error).message}`);
    }
  }

  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    try {
      if (filepath) filepath = repositoryPath(this.dir, filepath);
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
          if (filepath_walk === '.') return;

          if (filepath && filepath_walk !== filepath) return;

          let type1: string | null = null;
          if (entry1) type1 = await entry1.type();
          let type2: string | null = null;
          if (entry2) type2 = await entry2.type();

          if (type1 === 'tree' && type2 === 'tree') return;
          if (type1 === 'tree' || type2 === 'tree') return;

          let oid1: string | null = null;
          if (entry1) oid1 = await entry1.oid();
          let oid2: string | null = null;
          if (entry2) oid2 = await entry2.oid();

          if (oid1 === oid2) return;

          if (!oid1 && oid2) {
            changedFiles.push({ path: filepath_walk, type: 'added', oid2 });
          } else if (oid1 && !oid2) {
            changedFiles.push({ path: filepath_walk, type: 'deleted', oid1 });
          } else if (oid1 && oid2) {
            changedFiles.push({ path: filepath_walk, type: 'modified', oid1, oid2 });
          }
        },
      });

      if (changedFiles.length === 0) {
        return 'No differences between commits';
      }

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

      if (diffs.length > 0) return diffs.join('\n\n');
      return 'No differences between commits';
    } catch (error) {
      console.error('diffCommits error:', error);
      throw new Error(`Failed to diff commits: ${(error as Error).message}`);
    }
  }

  private async generateStagedDiff(filepath: string, headCommitHash: string): Promise<string> {
    try {
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

      let workContent = '';
      try {
        workContent = await this.fs.promises.readFile(`${this.dir}/${filepath}`, 'utf8');
      } catch {
        workContent = '';
      }

      const status = await git.statusMatrix({ fs: this.fs, dir: this.dir });
      const fileStatus = status.find(([file]) => file === filepath);

      if (!fileStatus) {
        return '';
      }

      const [, _HEAD, _workdir, stage] = fileStatus;

      if (stage === 3) {
        return this.formatDiff(filepath, '', workContent);
      }
      if (stage === 2) {
        return this.formatDiff(filepath, headContent, workContent);
      }

      return '';
    } catch (error) {
      throw new Error(`Failed to generate staged diff: ${(error as Error).message}`);
    }
  }

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
      newLines.forEach(line => {
        result += `+${line}\n`;
      });
    } else if (newContent === '') {
      result += 'deleted file mode 100644\n';
      result += `index ${this.generateShortHash(oldContent)}..0000000\n`;
      result += `--- a/${filepath}\n`;
      result += '+++ /dev/null\n';
      result += `@@ -1,${oldLines.length} +0,0 @@\n`;
      oldLines.forEach(line => {
        result += `-${line}\n`;
      });
    } else {
      result += `index ${this.generateShortHash(oldContent)}..${this.generateShortHash(newContent)} 100644\n`;
      result += `--- a/${filepath}\n`;
      result += `+++ b/${filepath}\n`;

      result += this.generateLineDiff(oldLines, newLines);
    }

    return result;
  }

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
      const oldLine = oldLines[i];
      const newLine = newLines[i];

      if (oldLine !== newLine) {
        if (!currentSection) {
          currentSection = {
            start: i + 1,
            oldCount: 0,
            newCount: 0,
            lines: [],
          };
        }

        if (oldLine !== undefined && newLine !== undefined) {
          currentSection.lines.push(`-${oldLine}`);
          currentSection.lines.push(`+${newLine}`);
          currentSection.oldCount++;
          currentSection.newCount++;
        } else if (oldLine !== undefined) {
          currentSection.lines.push(`-${oldLine}`);
          currentSection.oldCount++;
        } else if (newLine !== undefined) {
          currentSection.lines.push(`+${newLine}`);
          currentSection.newCount++;
        }
      } else if (currentSection) {
        if (oldLine !== undefined) {
          currentSection.lines.push(` ${oldLine}`);
        }

        if (currentSection.lines.length > 10) {
          diffSections.push(currentSection);
          currentSection = null;
        }
      }
    }

    if (currentSection) {
      diffSections.push(currentSection);
    }

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
      diffSections.forEach(section => {
        result += `@@ -${section.start},${section.oldCount} +${section.start},${section.newCount} @@\n`;
        result += `${section.lines.join('\n')}\n`;
      });
    }

    return result;
  }

  private generateShortHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16).substring(0, 7);
  }
}
