import type { MountStat } from '@/engine/runtime/storage/types';

export interface StatOptions {
  bigint?: boolean;
  throwIfNoEntry?: boolean;
}

export type FsNumeric = number | bigint;

export interface FsStats extends Omit<MountStat, 'size'> {
  size: FsNumeric;
  ctime: Date;
  birthtime: Date;
  atime: Date;
  ctimeMs: FsNumeric;
  birthtimeMs: FsNumeric;
  atimeMs: FsNumeric;
  mtimeMs: FsNumeric;
  mode: FsNumeric;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
}

export function fileMode(type: MountStat['type']): number {
  if (type === 'directory') return 0o40755;
  if (type === 'symlink') return 0o120777;
  return 0o100644;
}

function numeric(value: number, useBigInt: boolean): FsNumeric {
  if (useBigInt) return BigInt(value);
  return value;
}

export function createFsStats(value: MountStat, useBigInt = false): FsStats {
  const timestamp = value.mtime;
  const type = value.type;
  return {
    ...value,
    size: numeric(value.size, useBigInt),
    ctime: timestamp,
    birthtime: timestamp,
    atime: timestamp,
    ctimeMs: numeric(timestamp.getTime(), useBigInt),
    birthtimeMs: numeric(timestamp.getTime(), useBigInt),
    atimeMs: numeric(timestamp.getTime(), useBigInt),
    mtimeMs: numeric(timestamp.getTime(), useBigInt),
    mode: numeric(fileMode(type), useBigInt),
    isFile: () => type === 'file',
    isDirectory: () => type === 'directory',
    isSymbolicLink: () => type === 'symlink',
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
  };
}
