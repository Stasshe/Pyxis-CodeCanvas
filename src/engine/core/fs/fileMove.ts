import { FSError } from './errors';

export interface OpfsMovableFile extends FileSystemFileHandle {
  move?: (destination: FileSystemDirectoryHandle | string, newName?: string) => Promise<void>;
}

export async function movePersistentFile(
  source: OpfsMovableFile,
  destination: FileSystemDirectoryHandle,
  name: string,
  sourcePath: string,
  destinationPath: string,
  translate: (error: Error | DOMException, path: string) => FSError
): Promise<void> {
  if (!source.move) throw new FSError('ENOTSUP', sourcePath);
  try {
    await source.move(destination, name);
  } catch (error) {
    if (error instanceof DOMException) throw translate(error, destinationPath);
    throw error;
  }
}
