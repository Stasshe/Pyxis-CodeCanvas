import git, { type Walker, type WalkerEntry } from 'isomorphic-git';
import { classifyFileContent } from '@/engine/core/fileBytes';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';

import { GitFileSystemHelper } from './fileSystemHelper';

interface DiffEntry {
  bytes: Uint8Array;
  mode: string;
  oid: string;
}

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
      } catch (error) {
        if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;
        throw new Error('not a git repository (or any of the parent directories): .git');
      }

      const { staged, commit1, commit2, branchName } = options;
      let filepath = options.filepath;
      if (filepath) filepath = repositoryPath(this.dir, filepath);

      if (commit1 && commit2) {
        return await this.diffCommits(commit1, commit2, filepath);
      }
      if (branchName) {
        const head1 = await git.resolveRef({
          fs: this.fs,
          dir: this.dir,
          ref: 'HEAD',
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
    const output = await this.compareTrees([git.STAGE(), git.WORKDIR()], filepath, true);
    return output || 'No changes';
  }

  private async diffStaged(filepath?: string): Promise<string> {
    let head: string | undefined;
    try {
      head = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: 'HEAD' });
    } catch (error) {
      if (
        !(error instanceof git.Errors.NotFoundError) ||
        (error.data.what !== 'HEAD' && !error.data.what.startsWith('refs/heads/'))
      )
        throw error;
    }
    let trees = [git.STAGE()];
    if (head) trees = [git.TREE({ ref: head }), git.STAGE()];
    const output = await this.compareTrees(trees, filepath);
    return output || 'No staged changes';
  }

  async diffCommits(commit1: string, commit2: string, filepath?: string): Promise<string> {
    if (filepath) filepath = repositoryPath(this.dir, filepath);
    const output = await this.compareTrees(
      [git.TREE({ ref: commit1 }), git.TREE({ ref: commit2 })],
      filepath
    );
    return output || 'No differences between commits';
  }

  private async compareTrees(
    trees: Walker[],
    filepath?: string,
    worktree = false
  ): Promise<string> {
    const diffs: Array<{ path: string; output: string }> = [];
    await git.walk({
      fs: this.fs,
      dir: this.dir,
      trees,
      map: async (file, entries) => {
        if (file === '.') return;
        if (worktree && !entries[0]) return null;
        if (filepath && filepath !== '.' && file !== filepath && !file.startsWith(`${filepath}/`))
          return;
        let before = entries[0];
        let after = entries[1];
        if (trees.length === 1) {
          before = null;
          after = entries[0];
        }
        const previous = await this.readEntry(before);
        const next = await this.readEntry(after, worktree);
        if (!previous && !next) return;
        const output = this.formatEntryDiff(file, previous, next);
        if (output) diffs.push({ path: file, output });
      },
    });
    return diffs
      .sort((left, right) => left.path.localeCompare(right.path))
      .map(diff => diff.output)
      .join('\n\n');
  }

  private async readEntry(entry: WalkerEntry | null, worktree = false): Promise<DiffEntry | null> {
    if (!entry) return null;
    const type = await entry.type();
    if (type === 'tree') return null;
    if (type !== 'blob') throw new Error(`Unsupported Git diff entry type: ${type}`);
    let bytes: Uint8Array;
    if (worktree) {
      const content = await entry.content();
      if (!content) throw new Error('Git worktree entry content is unavailable');
      bytes = content;
    } else {
      const object = await git.readBlob({ fs: this.fs, dir: this.dir, oid: await entry.oid() });
      bytes = object.blob;
    }
    const { oid } = await git.hashBlob({ object: bytes });
    return { bytes, mode: (await entry.mode()).toString(8), oid };
  }

  private formatEntryDiff(
    filepath: string,
    previous: DiffEntry | null,
    next: DiffEntry | null
  ): string {
    const oldBytes = previous?.bytes ?? new Uint8Array();
    const newBytes = next?.bytes ?? new Uint8Array();
    const equalBytes =
      oldBytes.length === newBytes.length &&
      oldBytes.every((byte, index) => byte === newBytes[index]);
    if (previous && next && previous.mode === next.mode && equalBytes) return '';
    const header = `diff --git a/${filepath} b/${filepath}\n`;
    let modeChange = '';
    if (!previous && next) modeChange = `new file mode ${next.mode}\n`;
    else if (previous && !next) modeChange = `deleted file mode ${previous.mode}\n`;
    else if (previous && next && previous.mode !== next.mode)
      modeChange = `old mode ${previous.mode}\nnew mode ${next.mode}\n`;
    if (equalBytes) return header + modeChange;
    const oldContent = classifyFileContent('', oldBytes);
    const newContent = classifyFileContent('', newBytes);
    if (oldContent.kind === 'binary' || newContent.kind === 'binary') {
      let oldName = '/dev/null';
      let newName = '/dev/null';
      if (previous) oldName = `a/${filepath}`;
      if (next) newName = `b/${filepath}`;
      return `${header}${modeChange}Binary files ${oldName} and ${newName} differ`;
    }
    const output = this.formatDiff(
      filepath,
      oldContent.content,
      newContent.content,
      previous,
      next
    );
    if (previous && next && previous.mode !== next.mode)
      return header + modeChange + output.slice(header.length);
    return output;
  }

  private formatDiff(
    filepath: string,
    oldContent: string,
    newContent: string,
    previous: DiffEntry | null,
    next: DiffEntry | null
  ): string {
    if (oldContent === newContent) {
      return '';
    }

    let oldLines: string[] = [];
    let newLines: string[] = [];
    if (oldContent) oldLines = oldContent.split('\n');
    if (newContent) newLines = newContent.split('\n');
    const mode = next?.mode ?? previous?.mode ?? '100644';
    const oldOid = previous?.oid.slice(0, 7) ?? '0000000';
    const newOid = next?.oid.slice(0, 7) ?? '0000000';

    let result = `diff --git a/${filepath} b/${filepath}\n`;

    if (!previous) {
      result += `new file mode ${mode}\n`;
      result += `index 0000000..${newOid}\n`;
      result += '--- /dev/null\n';
      result += `+++ b/${filepath}\n`;
      result += `@@ -0,0 +1,${newLines.length} @@\n`;
      newLines.forEach(line => {
        result += `+${line}\n`;
      });
    } else if (!next) {
      result += `deleted file mode ${mode}\n`;
      result += `index ${oldOid}..0000000\n`;
      result += `--- a/${filepath}\n`;
      result += '+++ /dev/null\n';
      result += `@@ -1,${oldLines.length} +0,0 @@\n`;
      oldLines.forEach(line => {
        result += `-${line}\n`;
      });
    } else {
      result += `index ${oldOid}..${newOid} ${mode}\n`;
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
}
