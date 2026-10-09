import { basename } from '../pathUtils';
import { FSError } from './errors';
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
  emit = true
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
    event: { type, path, file: { path, type: 'file', size: file.size, mtime: file.lastModified } },
  };
}
