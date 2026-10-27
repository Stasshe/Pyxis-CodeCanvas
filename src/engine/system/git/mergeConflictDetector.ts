import git from 'isomorphic-git';
import { detectFileContent } from '@/engine/core/fileBytes';
import type { GitFs as FS, MergeConflictFileEntry } from '@/engine/core/fs/git';
import type { FsApi } from '@/engine/core/fs/types';

export class MergeConflictDetector {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  private async findMergeBase(ours: string, theirs: string): Promise<string | null> {
    try {
      const oursOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: ours });
      const theirsOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: theirs });

      const bases = await git.findMergeBase({
        fs: this.fs,
        dir: this.dir,
        oids: [oursOid, theirsOid],
      });

      if (bases.length > 0) return bases[0];
      return null;
    } catch (error) {
      console.error('[MergeConflictDetector] Failed to find merge base:', error);
      throw error;
    }
  }

  async detectConflicts(
    oursBranch: string,
    theirsBranch: string,
    conflictPaths?: ReadonlySet<string>
  ): Promise<MergeConflictFileEntry[]> {
    try {
      const conflicts: MergeConflictFileEntry[] = [];

      const baseOid = await this.findMergeBase(oursBranch, theirsBranch);

      if (!baseOid) {
        console.warn('[MergeConflictDetector] No merge base found');
        return [];
      }

      console.log('[MergeConflictDetector] Merge base:', baseOid);

      const oursOid = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: oursBranch,
      });
      const theirsOid = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: theirsBranch,
      });

      const changedFiles = new Map<
        string,
        { baseOid?: string; oursOid?: string; theirsOid?: string; symlink: boolean }
      >();

      await git.walk({
        fs: this.fs,
        dir: this.dir,
        trees: [
          git.TREE({ ref: baseOid }),
          git.TREE({ ref: oursOid }),
          git.TREE({ ref: theirsOid }),
        ],
        map: async (filepath, [baseEntry, oursEntry, theirsEntry]) => {
          if (filepath === '.') return;
          if (conflictPaths && !conflictPaths.has(filepath)) return;

          let baseType: string | null = null;
          if (baseEntry) baseType = await baseEntry.type();
          let oursType: string | null = null;
          if (oursEntry) oursType = await oursEntry.type();
          let theirsType: string | null = null;
          if (theirsEntry) theirsType = await theirsEntry.type();

          if (baseType === 'tree' || oursType === 'tree' || theirsType === 'tree') return;

          let baseOidVal: string | null = null;
          if (baseEntry) baseOidVal = await baseEntry.oid();
          let oursOidVal: string | null = null;
          if (oursEntry) oursOidVal = await oursEntry.oid();
          let theirsOidVal: string | null = null;
          if (theirsEntry) theirsOidVal = await theirsEntry.oid();

          const [baseMode, oursMode, theirsMode] = await Promise.all([
            baseEntry?.mode(),
            oursEntry?.mode(),
            theirsEntry?.mode(),
          ]);
          const modifiedInOurs = baseOidVal !== oursOidVal || baseMode !== oursMode;
          const modifiedInTheirs = baseOidVal !== theirsOidVal || baseMode !== theirsMode;

          if (
            modifiedInOurs &&
            modifiedInTheirs &&
            (oursOidVal !== theirsOidVal || oursMode !== theirsMode)
          ) {
            changedFiles.set(filepath, {
              symlink:
                (await baseEntry?.mode()) === 0o120000 ||
                (await oursEntry?.mode()) === 0o120000 ||
                (await theirsEntry?.mode()) === 0o120000,
              baseOid: baseOidVal || undefined,
              oursOid: oursOidVal || undefined,
              theirsOid: theirsOidVal || undefined,
            });
          }
        },
      });

      console.log('[MergeConflictDetector] Detected conflicts:', changedFiles.size);

      for (const [filepath, oids] of Array.from(changedFiles.entries())) {
        if (oids.symlink)
          throw new Error(`Cannot automatically resolve a symbolic link conflict: ${filepath}`);
        const versions = await Promise.all([
          this.readBlob(filepath, oids.baseOid),
          this.readBlob(filepath, oids.oursOid),
          this.readBlob(filepath, oids.theirsOid),
        ]);
        const [base, ours, theirs] = versions;
        const conflict: MergeConflictFileEntry = {
          filePath: `${this.dir}/${filepath}`,
          baseContent: '',
          oursContent: '',
          theirsContent: '',
          resolvedContent: '',
          isResolved: false,
        };
        if (versions.some(version => version?.content.kind === 'binary')) {
          conflict.binary = {
            base: base?.bytes ?? null,
            ours: ours?.bytes ?? null,
            theirs: theirs?.bytes ?? null,
            resolved: ours?.bytes ?? null,
          };
        } else {
          if (base?.content.kind === 'text') conflict.baseContent = base.content.content;
          if (ours?.content.kind === 'text') conflict.oursContent = ours.content.content;
          if (theirs?.content.kind === 'text') conflict.theirsContent = theirs.content.content;
          conflict.resolvedContent = conflict.oursContent;
          if (conflictPaths) {
            try {
              conflict.resolvedContent = selectOurs(
                await this.fs.promises.readFile(conflict.filePath, 'utf8')
              );
            } catch (error) {
              if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT')
                throw error;
            }
          }
        }
        conflicts.push(conflict);
      }

      return conflicts;
    } catch (error) {
      console.error('[MergeConflictDetector] Error detecting conflicts:', error);
      throw error;
    }
  }

  private async readBlob(path: string, oid: string | undefined) {
    if (!oid) return null;
    const { blob } = await git.readBlob({ fs: this.fs, dir: this.dir, oid });
    return { bytes: Uint8Array.from(blob), content: await detectFileContent(path, blob) };
  }
}

function selectOurs(content: string): string {
  let section: 'common' | 'ours' | 'theirs' = 'common';
  return content
    .split(/(?<=\n)/)
    .filter(line => {
      if (section === 'common' && line.startsWith('<<<<<<< ')) {
        section = 'ours';
        return false;
      }
      if (section === 'ours' && line.trimEnd() === '=======') {
        section = 'theirs';
        return false;
      }
      if (section === 'theirs' && line.startsWith('>>>>>>> ')) {
        section = 'common';
        return false;
      }
      return section !== 'theirs';
    })
    .join('');
}

export async function saveResolvedConflict(
  fs: Pick<FsApi, 'writeFile' | 'rm'>,
  file: MergeConflictFileEntry
): Promise<void> {
  if (file.binary) {
    if (file.binary.resolved === null) {
      await fs.rm(file.filePath, { force: true });
    } else {
      await fs.writeFile(file.filePath, file.binary.resolved);
    }
    return;
  }
  await fs.writeFile(file.filePath, file.resolvedContent);
}
