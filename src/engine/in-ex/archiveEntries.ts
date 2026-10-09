import { fsClient } from '@/engine/core/fs';
import type { ProjectFile } from '@/types';

function isSpecialEntry(type: ProjectFile['type']): boolean {
  return type === 'fifo' || type === 'characterDevice';
}

export async function assertArchiveEntriesReadable(entries: ProjectFile[]): Promise<void> {
  for (const entry of entries) {
    if (isSpecialEntry(entry.type)) {
      throw new Error(`Cannot export ${entry.type} entry: ${entry.path}`);
    }
    if (entry.type !== 'symlink') continue;

    const target = await fsClient.stat(entry.path);
    if (isSpecialEntry(target.type)) {
      throw new Error(`Cannot export symlink to ${target.type} entry: ${entry.path}`);
    }
  }
}
