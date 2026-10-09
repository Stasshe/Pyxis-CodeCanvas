import type { ProjectFile } from '@/types';
import { basename, getParentPath } from '../pathUtils';
import type { FifoDescriptors } from './descriptors';
import { FSError, translateFsError } from './errors';
import type { FifoEntries } from './fifo';
import type { Links } from './links';
import type { PermissionStore } from './permissions';
import { applyStoredMode, defaultMode } from './permissions';

export interface MetadataContext {
  descriptors: FifoDescriptors;
  fifoEntries: FifoEntries;
  links: Links;
  memory: Map<string, { metadata: ProjectFile }>;
  permissions: PermissionStore;
  isMemory(path: string): boolean;
  directory(path: string): Promise<FileSystemDirectoryHandle>;
}

export async function rawStat(path: string, fs: MetadataContext): Promise<ProjectFile> {
  const descriptor = fs.descriptors.stat(path) ?? fs.fifoEntries.stat(path);
  if (descriptor) return applyStoredMode(fs.permissions, descriptor, fs.isMemory(path));
  const link = fs.links.entries.get(path);
  if (link)
    return applyStoredMode(
      fs.permissions,
      {
        path,
        type: 'symlink',
        mode: defaultMode('symlink'),
        size: new TextEncoder().encode(link.target).length,
        mtime: link.mtime,
      },
      fs.isMemory(path)
    );
  if (fs.isMemory(path)) {
    const entry = fs.memory.get(path);
    if (!entry) throw new FSError('ENOENT', path);
    return { ...entry.metadata };
  }
  if (path === '/')
    return applyStoredMode(
      fs.permissions,
      { path, type: 'folder', mode: defaultMode('folder'), size: 0, mtime: 0 },
      false
    );
  const parent = await fs.directory(getParentPath(path));
  try {
    const fileHandle = await parent.getFileHandle(basename(path));
    const file = await fileHandle.getFile();
    return applyStoredMode(
      fs.permissions,
      {
        path,
        type: 'file',
        mode: defaultMode('file'),
        size: file.size,
        mtime: file.lastModified,
      },
      false
    );
  } catch (error) {
    if (error instanceof Error && error.name === 'TypeMismatchError') {
      await parent.getDirectoryHandle(basename(path));
      return applyStoredMode(
        fs.permissions,
        { path, type: 'folder', mode: defaultMode('folder'), size: 0, mtime: 0 },
        false
      );
    }
    if (error instanceof Error) throw translateFsError(error, path);
    throw error;
  }
}

export async function entryExists(
  path: string,
  followFinal: boolean,
  resolve: (path: string, followFinal: boolean) => Promise<string>,
  stat: (path: string) => Promise<ProjectFile>
): Promise<boolean> {
  try {
    await stat(await resolve(path, followFinal));
    return true;
  } catch (error) {
    if (error instanceof FSError && error.code === 'ENOENT') return false;
    throw error;
  }
}
