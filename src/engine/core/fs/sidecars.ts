import type { FSError } from './errors';
import type { FifoEntries, FifoEntry } from './fifo';
import type { LinkEntry, Links } from './links';

export async function removeDirectorySidecars(
  path: string,
  links: Links,
  fifos: FifoEntries
): Promise<(canRestore?: (path: string) => Promise<boolean>) => Promise<void>> {
  const descendants = (entryPath: string) => entryPath === path || entryPath.startsWith(`${path}/`);
  const linkEntries = [...links.entries.values()].filter(entry => descendants(entry.path));
  const fifoEntries = [...fifos.entries.values()].filter(entry => descendants(entry.path));
  const removedLinks: LinkEntry[] = [];
  const removedFifos: FifoEntry[] = [];
  const restore = async (canRestore: (path: string) => Promise<boolean> = async () => true) => {
    const failures: Error[] = [];
    for (const entry of removedLinks) {
      try {
        if (await canRestore(entry.path)) await links.create(entry.path, entry.target, entry.mtime);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    for (const entry of removedFifos) {
      try {
        if (await canRestore(entry.path)) await fifos.create(entry.path, entry);
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    if (failures.length > 0)
      throw new AggregateError(failures, `Failed to restore sidecars under ${path}`);
  };

  try {
    for (const entry of linkEntries) {
      removedLinks.push(entry);
      await links.remove(entry.path);
    }
    for (const entry of fifoEntries) {
      removedFifos.push(entry);
      await fifos.remove(entry.path);
    }
  } catch (error) {
    try {
      await restore();
    } catch (restoreError) {
      throw new AggregateError([error, restoreError], `Failed to remove sidecars under ${path}`);
    }
    throw error;
  }
  return restore;
}

export async function removeDirectory(
  path: string,
  parent: FileSystemDirectoryHandle,
  name: string,
  links: Links,
  fifos: FifoEntries,
  translate: (error: Error | DOMException, path: string) => FSError
): Promise<void> {
  const restore = await removeDirectorySidecars(path, links, fifos);
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (error) {
    const failure = error instanceof Error ? translate(error, path) : error;
    let sourceExists = true;
    try {
      await parent.getDirectoryHandle(name);
    } catch (lookupError) {
      if (lookupError instanceof DOMException && lookupError.name === 'NotFoundError') {
        sourceExists = false;
      }
    }
    if (sourceExists) {
      try {
        await restore(async entryPath => {
          const root = await parent.getDirectoryHandle(name);
          const relativeParent = entryPath
            .slice(path.length + 1)
            .split('/')
            .slice(0, -1);
          let directory = root;
          try {
            for (const component of relativeParent) {
              directory = await directory.getDirectoryHandle(component);
            }
            return true;
          } catch (lookupError) {
            if (lookupError instanceof DOMException && lookupError.name === 'NotFoundError')
              return false;
            throw lookupError;
          }
        });
      } catch (restoreError) {
        throw new AggregateError([failure, restoreError], `Failed to restore ${path}`);
      }
    }
    throw failure;
  }
}
