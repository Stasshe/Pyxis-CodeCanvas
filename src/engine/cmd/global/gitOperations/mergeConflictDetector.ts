import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';

import type { MergeConflictFileEntry } from '@/engine/tabs/types';

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
      return null;
    }
  }

  async detectConflicts(
    oursBranch: string,
    theirsBranch: string
  ): Promise<MergeConflictFileEntry[]> {
    try {
      const conflicts: MergeConflictFileEntry[] = [];

      const baseOid = await this.findMergeBase(
        `refs/heads/${oursBranch}`,
        `refs/heads/${theirsBranch}`
      );

      if (!baseOid) {
        console.warn('[MergeConflictDetector] No merge base found');
        return [];
      }

      console.log('[MergeConflictDetector] Merge base:', baseOid);

      const oursOid = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: `refs/heads/${oursBranch}`,
      });
      const theirsOid = await git.resolveRef({
        fs: this.fs,
        dir: this.dir,
        ref: `refs/heads/${theirsBranch}`,
      });

      const changedFiles = new Map<
        string,
        { baseOid?: string; oursOid?: string; theirsOid?: string }
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

          const modifiedInOurs = baseOidVal !== oursOidVal;
          const modifiedInTheirs = baseOidVal !== theirsOidVal;

          if (modifiedInOurs && modifiedInTheirs && oursOidVal !== theirsOidVal) {
            changedFiles.set(filepath, {
              baseOid: baseOidVal || undefined,
              oursOid: oursOidVal || undefined,
              theirsOid: theirsOidVal || undefined,
            });
          }
        },
      });

      console.log('[MergeConflictDetector] Detected conflicts:', changedFiles.size);

      for (const [filepath, oids] of Array.from(changedFiles.entries())) {
        let baseContent = '';
        if (oids.baseOid) baseContent = await this.readBlobContent(oids.baseOid);
        let oursContent = '';
        if (oids.oursOid) oursContent = await this.readBlobContent(oids.oursOid);
        let theirsContent = '';
        if (oids.theirsOid) theirsContent = await this.readBlobContent(oids.theirsOid);

        const normalizedPath = `${this.dir}/${filepath}`;

        conflicts.push({
          filePath: normalizedPath,
          baseContent,
          oursContent,
          theirsContent,
          resolvedContent: oursContent,
          isResolved: false,
        });
      }

      return conflicts;
    } catch (error) {
      console.error('[MergeConflictDetector] Error detecting conflicts:', error);
      return [];
    }
  }

  private async readBlobContent(oid: string): Promise<string> {
    try {
      const { object, type } = await git.readObject({
        fs: this.fs,
        dir: this.dir,
        oid,
      });

      if (type !== 'blob') {
        console.warn(`[MergeConflictDetector] Object ${oid} is not a blob (type: ${type})`);
        return '';
      }

      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(object as Uint8Array);
      } catch (decodeError) {
        console.warn('[mergeConflictDetector.ts] caught non-fatal error', decodeError);
        console.warn(
          `[MergeConflictDetector] File ${oid} appears to be binary, cannot decode as text`
        );
        return '[Binary file - cannot display content]';
      }
    } catch (error) {
      console.warn(`[MergeConflictDetector] Failed to read blob ${oid}:`, error);
      return '';
    }
  }
}
