import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Stat {
  type: 'dir' | 'file' | 'symlink';
  ino: number;
}
type Node = Map<string | number, Node | Stat>;

const fixture = vi.hoisted(() => ({ values: new Map<string | number, Node | Uint8Array>() }));

vi.mock('@/engine/core/migration/idb', () => ({
  readValue: async (_db: IDBDatabase, _store: string, key: string | number) =>
    fixture.values.get(key),
}));

import {
  gitProjectNames,
  type LegacyGitEntry,
  readGitEntries,
} from '@/engine/core/migration/lightning';

const db = {
  objectStoreNames: { contains: (name: string) => name === 'pyxis-fs_files' },
} as IDBDatabase;

function node(type: Stat['type'], ino: number, children: [string, Node][] = []): Node {
  const result: Node = new Map([[0, { type, ino }]]);
  for (const [name, child] of children) result.set(name, child);
  return result;
}

function tree(git: Node): Node {
  return new Map([
    [
      '/',
      node('dir', 0, [['projects', node('dir', 1, [['demo', node('dir', 2, [['.git', git]])]])]]),
    ],
  ]);
}

async function collectEntries(name: string): Promise<LegacyGitEntry[]> {
  const entries: LegacyGitEntry[] = [];
  for await (const entry of readGitEntries(db, name)) entries.push(entry);
  return entries;
}

describe('legacy lightning filesystem reader', () => {
  beforeEach(() => {
    fixture.values.clear();
  });

  it('reads the persisted nested Map and numeric inode bytes without decoding binary data', async () => {
    const git = node('dir', 3, [
      ['HEAD', node('file', 4)],
      ['objects', node('dir', 5, [['pack', node('file', 6)]])],
    ]);
    fixture.values.set('!root', tree(git));
    fixture.values.set(4, new Uint8Array([]));
    const packed = new Uint8Array([99, 0, 255, 128, 7, 88]);
    fixture.values.set(6, packed.subarray(1, 5));
    expect(await gitProjectNames(db)).toEqual(['demo']);
    const entries = await collectEntries('demo');
    expect(entries).toEqual([
      { path: '/.git', directory: true },
      { path: '/.git/HEAD', directory: false, bytes: new Uint8Array([]) },
      { path: '/.git/objects', directory: true },
      { path: '/.git/objects/pack', directory: false, bytes: new Uint8Array([0, 255, 128, 7]) },
    ]);
  });

  it('rejects missing inode data rather than importing an empty file', async () => {
    fixture.values.set('!root', tree(node('dir', 3, [['HEAD', node('file', 4)]])));
    await expect(collectEntries('demo')).rejects.toThrow('Missing legacy Git bytes');
  });

  it('rejects unsupported symlinks and directory traversal names', async () => {
    fixture.values.set('!root', tree(node('dir', 3, [['HEAD', node('symlink', 4)]])));
    await expect(collectEntries('demo')).rejects.toThrow('symlink');
    fixture.values.set('!root', tree(node('dir', 3, [['..', node('file', 4)]])));
    await expect(collectEntries('demo')).rejects.toThrow('filename');
  });
});
