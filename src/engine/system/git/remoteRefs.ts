import git from 'isomorphic-git';
import type { GitFs as FS } from '@/engine/core/fs/git';

export interface ParsedRemoteRef {
  remote: string;

  branch: string;

  fullRef: string;

  shortRef: string;

  isValid: boolean;
}

export const COMMON_REMOTES = ['origin', 'upstream'] as const;

export function parseRemoteRef(ref: string): ParsedRemoteRef | null {
  if (!ref || typeof ref !== 'string') {
    return null;
  }

  const trimmedRef = ref.trim();

  if (trimmedRef.startsWith('refs/remotes/')) {
    const parts = trimmedRef.slice('refs/remotes/'.length).split('/');
    if (parts.length >= 2) {
      const remote = parts[0];
      const branch = parts.slice(1).join('/');
      return {
        remote,
        branch,
        fullRef: trimmedRef,
        shortRef: `${remote}/${branch}`,
        isValid: true,
      };
    }
    return null;
  }

  if (trimmedRef.includes('/')) {
    const parts = trimmedRef.split('/');
    if (parts.length >= 2) {
      const remote = parts[0];
      const branch = parts.slice(1).join('/');

      if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(remote)) {
        return {
          remote,
          branch,
          fullRef: `refs/remotes/${remote}/${branch}`,
          shortRef: trimmedRef,
          isValid: true,
        };
      }
    }
  }

  return null;
}

export function isRemoteRef(ref: string): boolean {
  if (!ref) return false;

  if (ref.startsWith('refs/remotes/')) {
    return true;
  }

  for (const remote of COMMON_REMOTES) {
    if (ref.startsWith(`${remote}/`)) {
      return true;
    }
  }

  const parsed = parseRemoteRef(ref);
  return parsed !== null;
}

export function toFullRemoteRef(ref: string): string {
  if (ref.startsWith('refs/remotes/')) {
    return ref;
  }

  const parsed = parseRemoteRef(ref);
  if (parsed) {
    return parsed.fullRef;
  }

  return ref;
}

export async function resolveRemoteRef(fs: FS, dir: string, ref: string): Promise<string | null> {
  try {
    const fullRef = toFullRemoteRef(ref);
    const oid = await git.resolveRef({ fs, dir, ref: fullRef });
    return oid;
  } catch (error) {
    if (error instanceof git.Errors.NotFoundError) return null;
    throw error;
  }
}

export async function listRemoteBranches(
  fs: FS,
  dir: string,
  remote = 'origin'
): Promise<string[]> {
  const branches = await git.listBranches({ fs, dir, remote });
  return branches.filter(branch => branch !== 'HEAD');
}

export async function listAllRemoteRefs(fs: FS, dir: string): Promise<string[]> {
  const remotes = await git.listRemotes({ fs, dir });
  const refs = await Promise.all(
    remotes.map(async ({ remote }) => {
      const branches = await listRemoteBranches(fs, dir, remote);
      return branches.map(branch => `${remote}/${branch}`);
    })
  );
  return refs.flat().sort();
}
