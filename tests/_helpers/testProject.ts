/**
 * Load initial files into an explicitly injected test filesystem.
 */

import type { FsCore } from '@/engine/core/fs/core';
import { initialFileContents } from '@/engine/initialFileContents';
import { directoryTree } from './opfs';
import { resetTestFs } from './testFs';

// Initial file tree.
type FileNode =
  | { type: 'file'; content: string }
  | { type: 'folder'; children: Record<string, FileNode> };

/**
 * Flatten the initial file tree into entries.
 */
export function flattenInitialFiles(
  tree: Record<string, FileNode> = initialFileContents as Record<string, FileNode>,
  prefix = ''
): Array<{ path: string; content: string; type: 'file' | 'folder' }> {
  const entries: Array<{ path: string; content: string; type: 'file' | 'folder' }> = [];

  for (const [name, node] of Object.entries(tree)) {
    const path = `${prefix}/${name}`;

    if (node.type === 'file') {
      entries.push({ path, content: node.content, type: 'file' });
    } else if (node.type === 'folder') {
      entries.push({ path, content: '', type: 'folder' });
      if (node.children) {
        entries.push(...flattenInitialFiles(node.children, path));
      }
    }
  }

  return entries;
}

export function resetRepository(): FsCore {
  return resetTestFs();
}

export async function setupTestProject(projectName = 'TestProject'): Promise<{
  repo: FsCore;
  rootPath: string;
  projectName: string;
}> {
  const repo = resetTestFs();
  await repo.init(directoryTree());
  const rootPath = `/tmp/${projectName}`;
  await repo.mkdir(rootPath, { recursive: true });
  for (const entry of flattenInitialFiles()) {
    const path = `${rootPath}${entry.path}`;
    if (entry.type === 'folder') await repo.mkdir(path, { recursive: true });
    else await repo.writeFile(path, entry.content);
  }
  return { repo, rootPath, projectName };
}
