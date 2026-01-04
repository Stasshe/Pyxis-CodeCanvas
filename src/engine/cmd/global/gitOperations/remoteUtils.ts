/**
 * Remote Reference Utilities
 *
 * Provides standardized handling for remote branch references:
 * - origin/main -> refs/remotes/origin/main
 * - upstream/develop -> refs/remotes/upstream/develop
 *
 * This module centralizes the logic for parsing, validating, and resolving
 * remote references across all git operations.
 */

import type FS from '@isomorphic-git/lightning-fs';
import git from 'isomorphic-git';

/**
 * Represents a parsed remote reference
 */
export interface ParsedRemoteRef {
  /** Remote name (e.g., 'origin', 'upstream') */
  remote: string;
  /** Branch name on the remote */
  branch: string;
  /** Full reference path (e.g., 'refs/remotes/origin/main') */
  fullRef: string;
  /** Short reference (e.g., 'origin/main') */
  shortRef: string;
  /** Whether this is a valid remote reference */
  isValid: boolean;
}

/**
 * Well-known remote names that are commonly used
 */
export const COMMON_REMOTES = ['origin', 'upstream'] as const;

/**
 * Parse a remote reference string into its components
 *
 * @param ref Reference string (e.g., 'origin/main', 'refs/remotes/upstream/develop')
 * @returns Parsed remote reference or null if not a valid remote ref
 */
export function parseRemoteRef(ref: string): ParsedRemoteRef | null {
  if (!ref || typeof ref !== 'string') {
    return null;
  }

  const trimmedRef = ref.trim();

  // Handle full ref format: refs/remotes/remote/branch
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

  // Handle short ref format: remote/branch
  if (trimmedRef.includes('/')) {
    const parts = trimmedRef.split('/');
    if (parts.length >= 2) {
      const remote = parts[0];
      const branch = parts.slice(1).join('/');

      // Only consider it a remote ref if the first part looks like a remote name
      // (starts with a letter, contains only alphanumeric and dashes)
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

/**
 * Check if a reference looks like a remote reference
 *
 * @param ref Reference string to check
 * @returns true if the ref appears to be a remote reference
 */
export function isRemoteRef(ref: string): boolean {
  if (!ref) return false;

  // Full remote ref format
  if (ref.startsWith('refs/remotes/')) {
    return true;
  }

  // Short format with common remotes
  for (const remote of COMMON_REMOTES) {
    if (ref.startsWith(`${remote}/`)) {
      return true;
    }
  }

  // Check if it has remote/branch pattern with valid remote name
  const parsed = parseRemoteRef(ref);
  return parsed !== null;
}

/**
 * Convert a remote reference to its full refs/remotes format
 *
 * @param ref Reference string (short or full format)
 * @returns Full reference path or the original ref if not a remote ref
 */
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

/**
 * Convert a remote reference to its short format (remote/branch)
 *
 * @param ref Reference string (short or full format)
 * @returns Short reference or the original ref if not a remote ref
 */
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

/**
 * Resolve a remote reference to its commit OID
 *
 * @param fs File system instance
 * @param dir Repository directory
 * @param ref Remote reference to resolve
 * @returns Commit OID or null if not found
 */
export async function resolveRemoteRef(fs: FS, dir: string, ref: string): Promise<string | null> {
  try {
    const fullRef = toFullRemoteRef(ref);
    const oid = await git.resolveRef({ fs, dir, ref: fullRef });
    return oid;
  } catch {
    return null;
  }
}

/**
 * List all remote branches for a given remote
 *
 * @param fs File system instance
 * @param dir Repository directory
 * @param remote Remote name (default: 'origin')
 * @returns Array of branch names (without remote/ prefix)
 */
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
      // Skip hidden files and symbolic refs like HEAD
      if (!entry.startsWith('.') && entry !== 'HEAD') {
        branches.push(entry);
      }
    }

    return branches;
  } catch {
    return [];
  }
}

/**
 * List all remote tracking references
 *
 * @param fs File system instance
 * @param dir Repository directory
 * @returns Array of short remote refs (e.g., ['origin/main', 'upstream/develop'])
 */
export async function listAllRemoteRefs(fs: FS, dir: string): Promise<string[]> {
  const allRefs: string[] = [];

  for (const remote of COMMON_REMOTES) {
    try {
      const branches = await listRemoteBranches(fs, dir, remote);
      for (const branch of branches) {
        allRefs.push(`${remote}/${branch}`);
      }
    } catch {
      // Remote doesn't exist, skip
    }
  }

  // Also try to find other remotes
  try {
    const remotesDir = `${dir}/.git/refs/remotes`;
    const remotes = await fs.promises.readdir(remotesDir);

    for (const remote of remotes) {
      // Skip common remotes (already processed) and hidden files
      if (COMMON_REMOTES.includes(remote as (typeof COMMON_REMOTES)[number])) continue;
      if (remote.startsWith('.')) continue;

      try {
        const branches = await listRemoteBranches(fs, dir, remote);
        for (const branch of branches) {
          allRefs.push(`${remote}/${branch}`);
        }
      } catch {
        // Skip this remote
      }
    }
  } catch {
    // refs/remotes doesn't exist
  }

  return allRefs;
}

/**
 * Check if a remote exists in the repository
 *
 * @param fs File system instance
 * @param dir Repository directory
 * @param remote Remote name to check
 * @returns true if the remote exists
 */
export async function remoteExists(fs: FS, dir: string, remote: string): Promise<boolean> {
  try {
    const remotes = await git.listRemotes({ fs, dir });
    return remotes.some(r => r.remote === remote);
  } catch {
    return false;
  }
}

/**
 * Get the default remote for a branch
 *
 * @param fs File system instance
 * @param dir Repository directory
 * @param branch Branch name
 * @returns Remote name or 'origin' as default
 */
export async function getDefaultRemote(fs: FS, dir: string, _branch?: string): Promise<string> {
  try {
    const remotes = await git.listRemotes({ fs, dir });
    if (remotes.length === 0) {
      return 'origin';
    }

    // Prefer 'origin' if it exists
    if (remotes.some(r => r.remote === 'origin')) {
      return 'origin';
    }

    // Otherwise use the first remote
    return remotes[0].remote;
  } catch {
    return 'origin';
  }
}
