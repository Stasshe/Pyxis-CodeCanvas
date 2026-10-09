import type { ProjectFile } from '@/types';
import { basename, getParentPath } from '../pathUtils';
import { FSError } from './errors';
import type { PermissionStore } from './permissions';
import { defaultMode, initializeMode, permissionBits, withPermissionBits } from './permissions';
import type { FsChangeEvent } from './types';

export interface WriteRange {
  position: number | null;
  create: boolean;
  exclusive: boolean;
}

export function rangeEnd(path: string, size: number, data: Uint8Array, range: WriteRange): number {
  let offset = size;
  if (range.position !== null) offset = range.position;
  const end = offset + data.byteLength;
  if (!Number.isSafeInteger(end)) throw new FSError('EINVAL', path);
  return end;
}

/** Called inside the owner's path queue; all writes stage and commit on close. */
export async function writeStored(
  parent: FileSystemDirectoryHandle,
  path: string,
  data: Uint8Array,
  range?: WriteRange,
  emit = true,
  onCreate?: () => Promise<void>
): Promise<{ event: FsChangeEvent; end: number }> {
  let handle: FileSystemFileHandle;
  let type: FsChangeEvent['type'] = 'update';
  try {
    handle = await parent.getFileHandle(basename(path));
  } catch (error) {
    if (error instanceof Error && error.name === 'TypeMismatchError')
      throw new FSError('EISDIR', path);
    if (!(error instanceof Error) || error.name !== 'NotFoundError') throw error;
    if (range && !range.create) throw new FSError('ENOENT', path);
    await onCreate?.();
    handle = await parent.getFileHandle(basename(path), { create: true });
    type = 'create';
  }
  if (range?.exclusive && type === 'update') throw new FSError('EEXIST', path);
  let writer: FileSystemWritableFileStream | undefined;
  let end = data.byteLength;
  try {
    let writableData: Uint8Array<ArrayBuffer>;
    if (data.buffer instanceof ArrayBuffer) {
      writableData = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } else writableData = data.slice();
    if (range) {
      end = rangeEnd(path, (await handle.getFile()).size, data, range);
      writer = await handle.createWritable({ keepExistingData: true });
      if (data.byteLength > 0) {
        await writer.seek(end - data.byteLength);
        await writer.write(writableData);
      }
    } else {
      writer = await handle.createWritable();
      await writer.write(writableData);
    }
    await writer.close();
  } catch (error) {
    const failures = [error];
    if (writer) {
      try {
        await writer.abort();
      } catch (abortError) {
        failures.push(abortError);
      }
    }
    if (type === 'create') {
      try {
        await parent.removeEntry(basename(path));
      } catch (cleanupError) {
        failures.push(cleanupError);
      }
    }
    if (failures.length > 1) throw new AggregateError(failures, `Failed to write ${path}`);
    throw error;
  }
  if (!emit) return { end, event: { type, path } };
  const file = await handle.getFile();
  return {
    end,
    event: {
      type,
      path,
      file: {
        path,
        type: 'file',
        mode: defaultMode('file'),
        size: file.size,
        mtime: file.lastModified,
      },
    },
  };
}

export async function writeWithMode(
  parent: FileSystemDirectoryHandle,
  path: string,
  data: Uint8Array,
  range: WriteRange | undefined,
  emit: boolean,
  permissions: PermissionStore,
  mode?: number
): Promise<{ event: FsChangeEvent; end: number }> {
  let initialized = false;
  try {
    return await writeStored(parent, path, data, range, emit, async () => {
      await initializeMode(permissions, path, mode);
      initialized = true;
    });
  } catch (error) {
    if (initialized) {
      try {
        await parent.getFileHandle(basename(path));
      } catch (lookupError) {
        if (lookupError instanceof Error && lookupError.name === 'NotFoundError') {
          await permissions.remove([path]);
        }
      }
    }
    throw error;
  }
}

export async function writeMemory(
  memory: Map<string, { metadata: ProjectFile; data?: Uint8Array }>,
  path: string,
  data: Uint8Array,
  range: WriteRange | undefined,
  requestedMode: number | undefined,
  stat: (path: string) => Promise<ProjectFile>,
  emit: (event: FsChangeEvent) => void,
  shouldEmit: boolean
): Promise<number> {
  const existing = memory.get(path);
  if (range?.exclusive && existing) throw new FSError('EEXIST', path);
  if (existing?.metadata.type === 'folder') throw new FSError('EISDIR', path);
  if (range && !range.create && !existing) throw new FSError('ENOENT', path);
  const parent = await stat(getParentPath(path));
  if (parent.type !== 'folder') throw new FSError('ENOTDIR', parent.path);
  let end = data.byteLength;
  let content = data.slice();
  if (range) {
    const previous = existing?.data ?? new Uint8Array();
    end = rangeEnd(path, previous.byteLength, data, range);
    const size = data.byteLength > 0 ? Math.max(previous.byteLength, end) : previous.byteLength;
    content = new Uint8Array(size);
    content.set(previous);
    if (data.byteLength > 0) content.set(data, end - data.byteLength);
  }
  const metadata: ProjectFile = {
    path,
    type: 'file',
    mode:
      existing?.metadata.mode ??
      withPermissionBits(
        'file',
        requestedMode === undefined ? defaultMode('file') : permissionBits(requestedMode)
      ),
    size: content.byteLength,
    mtime: Date.now(),
  };
  memory.set(path, { metadata, data: content });
  if (shouldEmit) emit({ type: existing ? 'update' : 'create', path, file: { ...metadata } });
  return end;
}
