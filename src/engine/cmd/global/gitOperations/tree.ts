import type { GitFs as FS } from '@/engine/core/fs/git';

export async function tree(fs: FS, dirPath: string): Promise<string> {
  const lines: string[] = [];

  const traverse = async (currentPath: string, prefix: string) => {
    let entries: string[] = [];
    try {
      entries = await fs.promises.readdir(currentPath);
    } catch (e) {
      console.warn('[tree.ts] caught non-fatal error', e);
      return;
    }

    entries = entries.filter(e => e !== '.' && e !== '..');

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
      let connector = '├── ';
      let childPrefix = '│   ';
      if (isLast) {
        connector = '└── ';
        childPrefix = '    ';
      }
      const fullPath = `${currentPath}/${entry}`;

      try {
        const stat = await fs.promises.stat(fullPath);
        if (stat.isDirectory()) {
          lines.push(`${prefix}${connector}${entry}/`);
          await traverse(fullPath, `${prefix}${childPrefix}`);
        } else {
          lines.push(`${prefix}${connector}${entry}`);
        }
      } catch (e) {
        console.warn('[tree.ts] caught non-fatal error', e);
        lines.push(`${prefix}${connector}${entry}`);
      }
    }
  };

  const rootName = dirPath.replace(/\/$/, '') || '/';
  lines.push(`${rootName}/`);
  await traverse(dirPath, '');

  return lines.join('\n');
}
