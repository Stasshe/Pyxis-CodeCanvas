import type { ProjectFile } from '@/types';
import { basename, getParentPath } from '../pathUtils';
import { FSError, translateFsError } from './errors';
import type { FifoEntries } from './fifo';
import { movePersistentFile, type OpfsMovableFile } from './fileMove';
import { TMP_PATH } from './layout';
import type { Links } from './links';
import type { FsChangeEvent, MkdirOptions, RenameOptions, RmOptions } from './types';

interface MemoryEntry {
  metadata: ProjectFile;
  data?: Uint8Array;
}

interface RenameContext {
  resolve(path: string): Promise<string>;
  assertMutable(path: string): void;
  isMemory(path: string): boolean;
  lstat(path: string): Promise<ProjectFile>;
  stat(path: string): Promise<ProjectFile>;
  exists(path: string): Promise<boolean>;
  remove(path: string, options?: RmOptions, preservePermissions?: boolean): Promise<void>;
  mkdir(path: string, options?: MkdirOptions): Promise<void>;
  symlink(target: string, path: string): Promise<void>;
  readlink(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeFile(path: string, content: string | Uint8Array, options?: { mode?: number }): Promise<void>;
  movePermissions(source: string, destination: string, entries: ProjectFile[]): Promise<void>;
  readdir(path: string): Promise<ProjectFile[]>;
  walk(path: string): Promise<ProjectFile[]>;
  directory(path: string): Promise<FileSystemDirectoryHandle>;
  file(path: string): Promise<OpfsMovableFile>;
  links: Links;
  fifos: FifoEntries;
  memory: Map<string, MemoryEntry>;
  emit(event: FsChangeEvent): void;
}

export async function renamePath(
  oldInput: string,
  newInput: string,
  fs: RenameContext,
  options: RenameOptions = {}
): Promise<void> {
  const oldPath = await fs.resolve(oldInput);
  const path = await fs.resolve(newInput);
  fs.assertMutable(oldPath);
  fs.assertMutable(path);
  if (oldPath === path) {
    await fs.lstat(oldPath);
    return;
  }
  if (['/', TMP_PATH].includes(oldPath) || ['/', TMP_PATH].includes(path)) {
    throw new FSError('EBUSY', oldPath);
  }
  if (path.startsWith(`${oldPath}/`)) throw new FSError('EINVAL', path);
  const source = await fs.lstat(oldPath);
  if (
    fs.isMemory(oldPath) !== fs.isMemory(path) &&
    [...fs.fifos.entries.keys()].some(entry => entry === oldPath || entry.startsWith(`${oldPath}/`))
  ) {
    throw new FSError('EXDEV', oldPath);
  }
  const parent = await fs.stat(getParentPath(path));
  if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
  const destinationExists = await fs.exists(path);
  if (destinationExists && options.overwrite === false) throw new FSError('EEXIST', path);
  const destinationLink = fs.links.entries.get(path);
  const destinationFifo = fs.fifos.entries.get(path);
  const sourceLink = fs.links.entries.get(oldPath);
  const sourceFifo = fs.fifos.entries.get(oldPath);
  const destinationMemoryEntry = fs.isMemory(path) ? fs.memory.get(path) : undefined;
  let removedDestinationLink = false;
  let removedSourceEntry = false;
  let directoryCopyComplete = false;
  let preserveDestination = false;
  let sourceDirectoryEntries: ProjectFile[] | undefined;
  if (destinationExists) {
    const destination = await fs.lstat(path);
    if (source.type !== 'folder' && destination.type === 'folder') {
      throw new FSError('EISDIR', path);
    }
    if (source.type === 'folder' && destination.type !== 'folder') {
      throw new FSError('ENOTDIR', path);
    }
    if (destination.type === 'folder' && (await fs.walk(path)).length > 0) {
      throw new FSError('ENOTEMPTY', path);
    }
    if (
      (destination.type === 'symlink' || destination.type === 'fifo') &&
      destination.type !== source.type &&
      source.type !== 'symlink' &&
      source.type !== 'fifo'
    ) {
      await fs.remove(path, { recursive: true });
      removedDestinationLink = true;
    }
  }
  try {
    if (source.type === 'symlink') {
      if (!sourceLink) throw new FSError('EIO', oldPath);
      await fs.links.remove(oldPath);
      removedSourceEntry = true;
      if (destinationFifo) {
        removedDestinationLink = true;
        await fs.remove(path, { recursive: true });
      }
      if (!destinationExists) await fs.links.create(path, sourceLink.target, sourceLink.mtime);
      else {
        await fs.links.create(path, sourceLink.target, sourceLink.mtime);
        if (!destinationLink && !destinationFifo) {
          try {
            if (fs.isMemory(path)) fs.memory.delete(path);
            else await (await fs.directory(getParentPath(path))).removeEntry(basename(path));
          } catch (error) {
            try {
              await fs.links.remove(path);
            } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], `Failed to replace ${path}`);
            }
            throw error;
          }
        }
      }
    } else if (source.type === 'fifo') {
      if (!sourceFifo) throw new FSError('EIO', oldPath);
      await fs.fifos.remove(oldPath);
      removedSourceEntry = true;
      if (destinationLink) {
        removedDestinationLink = true;
        await fs.remove(path, { recursive: true });
      }
      await fs.fifos.replace(
        path,
        sourceFifo,
        destinationExists && !destinationFifo && !destinationLink,
        async () => {
          if (fs.isMemory(path)) fs.memory.delete(path);
          else await (await fs.directory(getParentPath(path))).removeEntry(basename(path));
        }
      );
    } else if (source.type === 'file' && !fs.isMemory(oldPath) && !fs.isMemory(path)) {
      await movePersistentFile(
        await fs.file(oldPath),
        await fs.directory(getParentPath(path)),
        basename(path),
        oldPath,
        path,
        translateFsError
      );
    } else if (source.type === 'file') {
      const data = await fs.readFile(oldPath);
      await fs.writeFile(path, data, { mode: source.mode });
      if (!fs.isMemory(oldPath) && fs.isMemory(path)) {
        try {
          await fs.remove(oldPath, { recursive: true }, true);
          removedSourceEntry = true;
        } catch (removeError) {
          try {
            if (!(await fs.exists(oldPath)))
              await fs.writeFile(oldPath, data, { mode: source.mode });
          } catch (restoreError) {
            preserveDestination = true;
            throw new AggregateError([removeError, restoreError], `Failed to restore ${oldPath}`);
          }
          throw removeError;
        }
      }
    } else {
      await fs.mkdir(path, { recursive: true, mode: source.mode });
      sourceDirectoryEntries = await fs.walk(oldPath);
      for (const entry of sourceDirectoryEntries) {
        const target = `${path}${entry.path.slice(oldPath.length)}`;
        if (entry.type === 'folder') await fs.mkdir(target, { recursive: true, mode: entry.mode });
        else if (entry.type === 'symlink') await fs.symlink(await fs.readlink(entry.path), target);
        else if (entry.type === 'fifo')
          await fs.fifos.create(target, fs.fifos.entries.get(entry.path));
        else await fs.writeFile(target, await fs.readFile(entry.path), { mode: entry.mode });
      }
      directoryCopyComplete = true;
    }
    if (
      !removedSourceEntry &&
      (source.type !== 'file' || fs.isMemory(oldPath) || fs.isMemory(path))
    ) {
      await fs.remove(oldPath, { recursive: true }, true);
    }
  } catch (error) {
    const rollbackErrors: Error[] = [];
    if (removedDestinationLink && (destinationLink || destinationFifo) && !preserveDestination) {
      try {
        await fs.remove(path, { recursive: true, force: true });
        if (destinationLink)
          await fs.links.create(path, destinationLink.target, destinationLink.mtime);
        else if (destinationFifo) await fs.fifos.create(path, destinationFifo);
      } catch (cleanupError) {
        rollbackErrors.push(asError(cleanupError));
      }
    }
    if (!destinationExists && !directoryCopyComplete && !preserveDestination) {
      try {
        await fs.remove(path, { recursive: true, force: true });
      } catch (cleanupError) {
        rollbackErrors.push(asError(cleanupError));
      }
    } else if (source.type === 'folder' && !directoryCopyComplete) {
      try {
        for (const entry of await fs.readdir(path))
          await fs.remove(entry.path, { recursive: true, force: true });
      } catch (cleanupError) {
        rollbackErrors.push(asError(cleanupError));
      }
    }
    if (removedSourceEntry) {
      try {
        if (sourceLink) await fs.links.create(oldPath, sourceLink.target, sourceLink.mtime);
        else if (sourceFifo) await fs.fifos.create(oldPath, sourceFifo);
      } catch (restoreError) {
        rollbackErrors.push(asError(restoreError));
      }
    }
    if (source.type === 'file' && destinationMemoryEntry && !preserveDestination)
      fs.memory.set(path, destinationMemoryEntry);
    try {
      await emitCurrentPath(fs, oldPath, true, 'update', sourceDirectoryEntries);
      await emitCurrentPath(fs, path, destinationExists, 'create');
    } catch (reconcileError) {
      rollbackErrors.push(asError(reconcileError));
    }
    if (rollbackErrors.length > 0) {
      throw new AggregateError(
        [asError(error), ...rollbackErrors],
        `Failed to rename ${oldPath} to ${path}`
      );
    }
    throw error;
  }
  const permissionEntries = [source, ...(sourceDirectoryEntries ?? [])];
  if (fs.isMemory(path)) applyMemoryModes(oldPath, path, permissionEntries, fs.memory);
  try {
    await fs.movePermissions(oldPath, path, permissionEntries);
  } catch (error) {
    await emitCurrentPath(fs, oldPath, true, 'update', sourceDirectoryEntries);
    await emitCurrentPath(fs, path, destinationExists, 'create');
    throw error;
  }
  fs.emit({ type: 'rename', oldPath, path, file: await fs.lstat(path) });
}

function applyMemoryModes(
  source: string,
  destination: string,
  entries: ProjectFile[],
  memory: Map<string, MemoryEntry>
): void {
  for (const entry of entries) {
    if (entry.type !== 'file' && entry.type !== 'folder') continue;
    const destinationPath = `${destination}${entry.path.slice(source.length)}`;
    const target = memory.get(destinationPath);
    if (target) target.metadata.mode = entry.mode;
  }
}

async function emitCurrentPath(
  fs: RenameContext,
  path: string,
  existedBefore: boolean,
  descendantType: FsChangeEvent['type'],
  previousDescendants?: ProjectFile[]
): Promise<void> {
  if (!(await fs.exists(path))) {
    if (existedBefore) fs.emit({ type: 'delete', path });
    return;
  }

  const file = await fs.lstat(path);
  fs.emit({ type: existedBefore ? 'update' : 'create', path, file });
  if (file.type !== 'folder') return;
  const entries = await fs.walk(path);
  if (previousDescendants) {
    const currentPaths = new Set(entries.map(entry => entry.path));
    const missingPaths = new Set(
      previousDescendants.filter(entry => !currentPaths.has(entry.path)).map(entry => entry.path)
    );
    for (const entry of previousDescendants) {
      if (missingPaths.has(entry.path) && !missingPaths.has(getParentPath(entry.path))) {
        fs.emit({ type: 'delete', path: entry.path });
      }
    }
  }
  for (const entry of entries) {
    fs.emit({ type: descendantType, path: entry.path, file: entry });
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
