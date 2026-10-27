import type { InitialFileTree } from '@/engine/core/workspace/initialFileContents';
import { initialFileContents } from '@/engine/core/workspace/initialFileContents';
import { HOME_DIR, resolvePath } from '../paths';
import type { StartupProgress } from '../startup';
import type { FsApi } from './types';

type WorkspaceFs = Pick<FsApi, 'mkdir' | 'writeFile' | 'exists' | 'stat'>;

async function copyInitialFiles(
  fs: WorkspaceFs,
  rootPath: string,
  tree: InitialFileTree,
  progress: { completed: number; total: number },
  report?: (progress: StartupProgress) => void
): Promise<void> {
  for (const [name, entry] of Object.entries(tree)) {
    const path = resolvePath(rootPath, name);
    if (entry.type === 'file') {
      await fs.writeFile(path, entry.content);
    } else {
      await fs.mkdir(path);
    }
    progress.completed += 1;
    await report?.({ detail: path, ...progress });
    if (entry.type === 'folder') {
      await copyInitialFiles(fs, path, entry.children, progress, report);
    }
  }
}

function entryCount(tree: InitialFileTree): number {
  let count = 0;
  for (const entry of Object.values(tree)) {
    count += 1;
    if (entry.type === 'folder') count += entryCount(entry.children);
  }
  return count;
}

export async function createWorkspace(fs: WorkspaceFs, name: string): Promise<string> {
  if (!name || name === '.' || name === '..' || name.includes('/')) {
    throw new Error(`Invalid workspace name: ${name}`);
  }
  const rootPath = resolvePath(HOME_DIR, name);
  await fs.mkdir(rootPath);
  return rootPath;
}

export async function ensureDemoWorkspace(
  fs: WorkspaceFs,
  report?: (progress: StartupProgress) => void
): Promise<string> {
  const rootPath = resolvePath(HOME_DIR, 'demo');
  if (await fs.exists(rootPath)) {
    const entry = await fs.stat(rootPath);
    if (entry.type !== 'folder') {
      throw new Error(`Cannot create demo workspace: ${rootPath} is an existing file.`);
    }
    return rootPath;
  }
  await fs.mkdir(rootPath);
  const progress = { completed: 0, total: entryCount(initialFileContents) };
  await report?.({ detail: rootPath, ...progress });
  await copyInitialFiles(fs, rootPath, initialFileContents, progress, report);
  return rootPath;
}
