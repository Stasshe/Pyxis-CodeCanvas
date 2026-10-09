import { basename, fsClient, normalizePath } from '@/engine/core/fs/index';
import { listRecentFolders } from '@/engine/core/metadata/recentFolderStorageAdapter';
import { setCurrentProject } from '@/stores/projectStore';
import type { Project } from '@/types/index';

export function projectFromPath(rootPath: string): Project {
  const normalizedPath = normalizePath(rootPath);
  let name = basename(normalizedPath);
  if (!name) name = '/';
  return { rootPath: normalizedPath, name, updatedAt: new Date() };
}

let projectStartupError: string | null = null;

export async function prepareProjectStore(): Promise<void> {
  try {
    const recentFolders = await listRecentFolders();
    if (recentFolders.length === 0) return;
    const project = projectFromPath(recentFolders[0].rootPath);
    const rootEntry = await fsClient.stat(project.rootPath);
    if (rootEntry.type !== 'folder') throw new Error(`${project.rootPath} is not a folder.`);
    setCurrentProject(project);
    projectStartupError = null;
  } catch (error) {
    let message = String(error);
    if (error instanceof Error) message = error.message;
    console.error('[Project] Recent folder could not be opened:', error);
    setCurrentProject(null);
    projectStartupError = message;
  }
}

export function getProjectStartupError(): string | null {
  return projectStartupError;
}

export function clearProjectStartupError(): void {
  projectStartupError = null;
}
