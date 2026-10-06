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

export function toShortRemoteRef(ref: string): string {
  if (ref.startsWith('refs/remotes/')) {
    return ref.slice('refs/remotes/'.length);
  }

  const parsed = parseRemoteRef(ref);
  if (parsed) {
    return parsed.shortRef;
  }

  return ref;
}

export async function resolveRemoteRef(fs: FS, dir: string, ref: string): Promise<string | null> {
  try {
    const fullRef = toFullRemoteRef(ref);
    const oid = await git.resolveRef({ fs, dir, ref: fullRef });
    return oid;
  } catch {
    return null;
  }
}

export async function listRemoteBranches(
  fs: FS,
  dir: string,
  remote = 'origin'
): Promise<string[]> {
  try {
    const remotesDir = `${dir}/.git/refs/remotes/${remote}`;
    const entries = await fs.promises.readdir(remotesDir);

    const branches: string[] = [];
    for (const entry of entries) {
      if (!entry.startsWith('.') && entry !== 'HEAD') {
        branches.push(entry);
      }
    }

    return branches;
  } catch {
    return [];
  }
}

export async function listAllRemoteRefs(fs: FS, dir: string): Promise<string[]> {
  const allRefs: string[] = [];

  for (const remote of COMMON_REMOTES) {
    try {
      const branches = await listRemoteBranches(fs, dir, remote);
      for (const branch of branches) {
        allRefs.push(`${remote}/${branch}`);
      }
    } catch {}
  }

  try {
    const remotesDir = `${dir}/.git/refs/remotes`;
    const remotes = await fs.promises.readdir(remotesDir);

    for (const remote of remotes) {
      if (COMMON_REMOTES.includes(remote as (typeof COMMON_REMOTES)[number])) continue;
      if (remote.startsWith('.')) continue;

      try {
        const branches = await listRemoteBranches(fs, dir, remote);
        for (const branch of branches) {
          allRefs.push(`${remote}/${branch}`);
        }
      } catch {}
    }
  } catch {}

  return allRefs;
}

export async function remoteExists(fs: FS, dir: string, remote: string): Promise<boolean> {
  try {
    const remotes = await git.listRemotes({ fs, dir });
    return remotes.some(r => r.remote === remote);
  } catch {
    return false;
  }
}

export async function getDefaultRemote(fs: FS, dir: string, _branch?: string): Promise<string> {
  try {
    const remotes = await git.listRemotes({ fs, dir });
    if (remotes.length === 0) {
      return 'origin';
    }

    if (remotes.some(r => r.remote === 'origin')) {
      return 'origin';
    }

    return remotes[0].remote;
  } catch {
    return 'origin';
  }
}
