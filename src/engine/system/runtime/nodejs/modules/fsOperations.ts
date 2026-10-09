import type { RuntimeFsMount } from '@/engine/system/runtime/fs/RuntimeFsMount';
import { constants } from './constantsModule';

export async function copyFile(
  filesystem: RuntimeFsMount,
  source: string,
  destination: string,
  flags = 0
): Promise<void> {
  const content = await filesystem.getFile(source);
  if (content === undefined)
    throw Object.assign(new Error(`ENOENT: copyfile '${source}'`), { code: 'ENOENT' });
  if ((flags & constants.COPYFILE_EXCL) !== 0) {
    await filesystem.writeRange(destination, content, 0, true, true);
    return;
  }
  await filesystem.setFile(destination, content);
}

export function copyFileSync(
  filesystem: RuntimeFsMount,
  source: string,
  destination: string,
  flags = 0
): void {
  const content = filesystem.getFileSync(source);
  if (content === undefined)
    throw Object.assign(new Error(`ENOENT: copyfile '${source}'`), { code: 'ENOENT' });
  if ((flags & constants.COPYFILE_EXCL) !== 0) {
    filesystem.writeRangeSync(destination, content, 0, true, true);
    return;
  }
  filesystem.setFileSync(destination, content);
}

export async function removeDirectory(filesystem: RuntimeFsMount, path: string): Promise<void> {
  const value = await filesystem.lstat(path);
  if (!value) throw Object.assign(new Error(`ENOENT: rmdir '${path}'`), { code: 'ENOENT' });
  if (value.type !== 'directory')
    throw Object.assign(new Error(`ENOTDIR: rmdir '${path}'`), { code: 'ENOTDIR' });
  await filesystem.rmdir(path);
}

export function removeDirectorySync(filesystem: RuntimeFsMount, path: string): void {
  const value = filesystem.lstatSync(path);
  if (!value) throw Object.assign(new Error(`ENOENT: rmdir '${path}'`), { code: 'ENOENT' });
  if (value.type !== 'directory')
    throw Object.assign(new Error(`ENOTDIR: rmdir '${path}'`), { code: 'ENOTDIR' });
  filesystem.rmdirSync(path);
}

export async function makeTempDirectory(
  filesystem: RuntimeFsMount,
  prefix: string
): Promise<string> {
  let attempt = 0;
  while (attempt < 16) {
    const path = `${prefix}${randomSuffix()}`;
    try {
      await filesystem.mkdir(path);
      return path;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      attempt += 1;
    }
  }
  throw Object.assign(new Error(`EEXIST: mkdtemp '${prefix}'`), { code: 'EEXIST' });
}

export function makeTempDirectorySync(filesystem: RuntimeFsMount, prefix: string): string {
  let attempt = 0;
  while (attempt < 16) {
    const path = `${prefix}${randomSuffix()}`;
    try {
      filesystem.mkdirSync(path);
      return path;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      attempt += 1;
    }
  }
  throw Object.assign(new Error(`EEXIST: mkdtemp '${prefix}'`), { code: 'EEXIST' });
}

function randomSuffix(): string {
  const alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
  let value = '';
  while (value.length < 6) {
    const random = crypto.getRandomValues(new Uint8Array(6));
    for (const byte of random) {
      if (byte >= 252) continue;
      const character = alphabet[byte % alphabet.length];
      if (character) value += character;
      if (value.length === 6) break;
    }
  }
  return value;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST';
}
