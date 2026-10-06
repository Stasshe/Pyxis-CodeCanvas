import git from 'isomorphic-git';
import { type GitFs as FS, repositoryPath } from '@/engine/core/fs/git';

export async function show(fs: FS, dir: string, args: string[]): Promise<string> {
  try {
    if (args.length === 0) {
      return 'git show: missing commit or file';
    }

    const arg = args[0];

    const colonIndex = arg.indexOf(':');

    if (colonIndex !== -1) {
      const commitRef = arg.substring(0, colonIndex);
      const filePath = arg.substring(colonIndex + 1);

      return await showCommitFile(fs, dir, commitRef, filePath);
    }
    return await showCommit(fs, dir, arg);
  } catch (error) {
    throw new Error(`git show: ${(error as Error).message}`);
  }
}

async function showCommitFile(
  fs: FS,
  dir: string,
  commitRef: string,
  filePath: string
): Promise<string> {
  try {
    const commitOid = await resolveRef(fs, dir, commitRef);

    if (!commitOid) {
      return `fatal: ${commitRef}: unknown revision or path not in the working tree.`;
    }

    const normalizedPath = repositoryPath(dir, filePath);

    try {
      const { blob } = await git.readBlob({
        fs,
        dir,
        oid: commitOid,
        filepath: normalizedPath,
      });

      const content = new TextDecoder().decode(blob);

      return content;
    } catch (readError) {
      const err = readError as Error;
      if (err.message.includes('not found') || err.message.includes('Could not find')) {
        return `fatal: Path '${filePath}' does not exist in '${commitRef}'`;
      }
      throw err;
    }
  } catch (error) {
    throw new Error(`Failed to show file: ${(error as Error).message}`);
  }
}

async function showCommit(fs: FS, dir: string, commitRef: string): Promise<string> {
  try {
    const commitOid = await resolveRef(fs, dir, commitRef);

    if (!commitOid) {
      return `fatal: ${commitRef}: unknown revision or path not in the working tree.`;
    }

    const commit = await git.readCommit({
      fs,
      dir,
      oid: commitOid,
    });

    const { author, message } = commit.commit;

    let result = `commit ${commitOid}\n`;

    if (author) {
      const authorDate = new Date(author.timestamp * 1000).toLocaleString();
      result += `Author: ${author.name} <${author.email}>\n`;
      result += `Date:   ${authorDate}\n`;
    }

    result += `\n    ${message}\n`;

    if (commit.commit.parent && commit.commit.parent.length > 0) {
      result += `\nParent: ${commit.commit.parent.join(', ')}\n`;
    }

    return result;
  } catch (error) {
    throw new Error(`Failed to show commit: ${(error as Error).message}`);
  }
}

async function resolveRef(fs: FS, dir: string, ref: string): Promise<string | null> {
  try {
    const isCommitHash = /^[a-f0-9]{4,}$/i.test(ref);

    if (isCommitHash) {
      try {
        const oid = await git.expandOid({
          fs,
          dir,
          oid: ref,
        });
        return oid;
      } catch {
        return null;
      }
    }

    if (ref.startsWith('HEAD')) {
      try {
        const oid = await git.resolveRef({
          fs,
          dir,
          ref,
        });
        return oid;
      } catch {
        return null;
      }
    }

    if (ref.includes('/')) {
      try {
        const oid = await git.resolveRef({
          fs,
          dir,
          ref: `refs/remotes/${ref}`,
        });
        return oid;
      } catch {}
    }

    try {
      const oid = await git.resolveRef({
        fs,
        dir,
        ref,
      });
      return oid;
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
