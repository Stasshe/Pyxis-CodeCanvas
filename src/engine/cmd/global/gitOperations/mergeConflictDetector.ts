import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

import type { MergeConflictFileEntry } from '@/engine/tabs/types';

/**
 * Detect and extract merge conflict information
 */
export class MergeConflictDetector {
  private fs: FS;
  private dir: string;

  constructor(fs: FS, dir: string) {
    this.fs = fs;
    this.dir = dir;
  }

  /**
   * Find the merge base (common ancestor) between two branches
   */
  private async findMergeBase(ours: string, theirs: string): Promise<string | null> {
    try {
      const oursOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: ours });
      const theirsOid = await git.resolveRef({ fs: this.fs, dir: this.dir, ref: theirs });

      // Use isomorphic-git's findMergeBase
      const bases = await git.findMergeBase({
        fs: this.fs,
        dir: this.dir,
        oids: [oursOid, theirsOid],
      });

      return bases.length > 0 ? bases[0] : null;
    } catch (error) {
      console.error('[MergeConflictDetector] Failed to find merge base:', error);
      return null;
    }
  }

  /**
   * Detect conflicting files by comparing two branches
   * Returns files that have different content in both branches compared to their common ancestor
   */
  async detectConflicts(
    oursBranch: string,
    theirsBranch: string
  ): Promise<MergeConflictFileEntry[]> {
    try {
      const conflicts: MergeConflictFileEntry[] = [];

      // Find merge base
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

      // Use git.walk to compare trees
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

          const baseType = baseEntry ? await baseEntry.type() : null;
          const oursType = oursEntry ? await oursEntry.type() : null;
          const theirsType = theirsEntry ? await theirsEntry.type() : null;

          // Skip directories
          if (baseType === 'tree' || oursType === 'tree' || theirsType === 'tree') return;

          const baseOidVal = baseEntry ? await baseEntry.oid() : null;
          const oursOidVal = oursEntry ? await oursEntry.oid() : null;
          const theirsOidVal = theirsEntry ? await theirsEntry.oid() : null;

          // Check if file was modified in both branches
          const modifiedInOurs = baseOidVal !== oursOidVal;
          const modifiedInTheirs = baseOidVal !== theirsOidVal;

          if (modifiedInOurs && modifiedInTheirs && oursOidVal !== theirsOidVal) {
            // This is a potential conflict
            changedFiles.set(filepath, {
              baseOid: baseOidVal || undefined,
              oursOid: oursOidVal || undefined,
              theirsOid: theirsOidVal || undefined,
            });
          }
        },
      });

      console.log('[MergeConflictDetector] Detected conflicts:', changedFiles.size);

      // Read content for each conflicting file
      for (const [filepath, oids] of Array.from(changedFiles.entries())) {
        const baseContent = oids.baseOid ? await this.readBlobContent(oids.baseOid) : '';
        const oursContent = oids.oursOid ? await this.readBlobContent(oids.oursOid) : '';
        const theirsContent = oids.theirsOid ? await this.readBlobContent(oids.theirsOid) : '';

        conflicts.push({
          filePath: `/${filepath}`,
          baseContent,
          oursContent,
          theirsContent,
          resolvedContent: oursContent, // Default to ours
          isResolved: false,
        });
      }

      return conflicts;
    } catch (error) {
      console.error('[MergeConflictDetector] Error detecting conflicts:', error);
      return [];
    }
  }

  /**
   * Read blob content by OID
   */
  private async readBlobContent(oid: string): Promise<string> {
    try {
      const { object, type } = await git.readObject({
        fs: this.fs,
        dir: this.dir,
        oid,
      });

      // Ensure it's a blob type
      if (type !== 'blob') {
        console.warn(`[MergeConflictDetector] Object ${oid} is not a blob (type: ${type})`);
        return '';
      }

      return new TextDecoder().decode(object as Uint8Array);
    } catch (error) {
      console.warn(`[MergeConflictDetector] Failed to read blob ${oid}:`, error);
      return '';
    }
  }
}
