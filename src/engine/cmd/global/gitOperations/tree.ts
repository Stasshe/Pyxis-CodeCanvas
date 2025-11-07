import type FS from '@isomorphic-git/lightning-fs';

/**
 * Return a string representation of the directory tree for a given directory in lightning-fs.
 * This will read directories recursively and format a tree similar to unix `tree` command.
 */
export async function tree(fs: FS, dirPath: string): Promise<string> {
  const lines: string[] = [];

  const traverse = async (currentPath: string, prefix: string) => {
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(currentPath);
    } catch (e) {
      // no read permission or not exist
      return;
    }

    // filter out special entries
    entries = entries.filter(e => e !== '.' && e !== '..');

    // sort so output is deterministic: directories first, then files, alphabetical
    const dirs: string[] = [];
    const files: string[] = [];
    for (const entry of entries) {
      try {
        const stat = await fs.promises.stat(`${currentPath}/${entry}`);
        if (stat.isDirectory()) dirs.push(entry);
        else files.push(entry);
      } catch {
        files.push(entry);
      }
    }

    const all = [...dirs.sort(), ...files.sort()];

    for (let i = 0; i < all.length; i++) {
      const entry = all[i];
      const isLast = i === all.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const fullPath = `${currentPath}/${entry}`;

      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          lines.push(`${prefix}${connector}${entry}/`);
          await traverse(fullPath, `${prefix}${isLast ? '    ' : '│   '}`);
        } else {
          lines.push(`${prefix}${connector}${entry}`);
        }
      } catch (e) {
        lines.push(`${prefix}${connector}${entry}`);
      }
    }
  };

  // show root directory name
  const rootName = dirPath.replace(/\/$/, '') || '/';
  lines.push(`${rootName}/`);
  await traverse(dirPath, '');

  return lines.join('\n');
}
