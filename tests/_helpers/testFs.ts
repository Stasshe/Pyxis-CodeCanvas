import { FsCore } from '@/engine/core/fs/core';

let current = new FsCore();
export function getTestFs(): FsCore {
  return current;
}
export function resetTestFs(): FsCore {
  current = new FsCore();
  return current;
}
