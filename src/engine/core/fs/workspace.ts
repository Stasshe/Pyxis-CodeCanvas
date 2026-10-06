import type { InitialFileTree } from '@/engine/initialFileContents';
import { initialFileContents } from '@/engine/initialFileContents';
import { HOME_DIR, resolvePath } from '../pathUtils';
import type { FsApi } from './types';

type WorkspaceFs = Pick<FsApi, 'mkdir' | 'writeFile' | 'exists' | 'stat'>;

async function copyInitialFiles(
  fs: WorkspaceFs,
  rootPath: string,
  tree: InitialFileTree
): Promise<void> {
  for (const [name, entry] of Object.entries(tree)) {
    const path = resolvePath(rootPath, name);
    if (entry.type === 'file') {
      await fs.writeFile(path, entry.content);
      continue;
    }
    await fs.mkdir(path);
    await copyInitialFiles(fs, path, entry.children);
  }
}

export async function createWorkspace(fs: WorkspaceFs, name: string): Promise<string> {
  if (!name || name === '.' || name === '..' || name.includes('/')) {
    throw new Error(`Invalid workspace name: ${name}`);
  }
  const rootPath = resolvePath(HOME_DIR, name);
  await fs.mkdir(rootPath);
  return rootPath;
}

export async function ensureDemoWorkspace(fs: WorkspaceFs): Promise<string> {
  const rootPath = resolvePath(HOME_DIR, 'demo');
  if (await fs.exists(rootPath)) {
    const entry = await fs.stat(rootPath);
    if (entry.type !== 'folder') {
      throw new Error(`Cannot create demo workspace: ${rootPath} is an existing file.`);
    }
    return rootPath;
  }
  await fs.mkdir(rootPath);
  await copyInitialFiles(fs, rootPath, initialFileContents);
  return rootPath;
}
