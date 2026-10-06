import { readValue } from './idb';

interface LightningStat {
  type: 'dir' | 'file' | 'symlink';
  ino: number;
}

type LightningNode = Map<string | number, LightningNode | LightningStat>;

export interface LegacyGitEntry {
  path: string;
  directory: boolean;
  bytes?: Uint8Array;
}

function child(node: LightningNode, name: string): LightningNode | undefined {
  const value = node.get(name);
  if (value instanceof Map) return value;
  if (value !== undefined) throw new Error(`Invalid legacy Git directory: ${name}`);
  return undefined;
}

async function projectTree(db: IDBDatabase | null): Promise<LightningNode | undefined> {
  if (!db || !db.objectStoreNames.contains('pyxis-fs_files')) return undefined;
  const superblock = await readValue<LightningNode>(db, 'pyxis-fs_files', '!root');
  if (!superblock) {
    const count = await new Promise<number>((resolve, reject) => {
      const request = db.transaction('pyxis-fs_files').objectStore('pyxis-fs_files').count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (count > 0) throw new Error('Missing legacy Git filesystem superblock');
    return undefined;
  }
  if (!(superblock instanceof Map)) throw new Error('Invalid legacy Git filesystem superblock');
  const root = child(superblock, '/');
  if (!root) throw new Error('Missing legacy Git filesystem root');
  return child(root, 'projects');
}

export async function gitProjectNames(db: IDBDatabase | null): Promise<string[]> {
  const projects = await projectTree(db);
  if (!projects) return [];
  const names: string[] = [];
  for (const [name, node] of projects) {
    if (typeof name !== 'string') continue;
    if (!(node instanceof Map)) throw new Error(`Invalid legacy Git project: ${name}`);
    if (child(node, '.git')) names.push(name);
  }
  return names;
}

export async function readGitEntries(
  db: IDBDatabase | null,
  name: string
): Promise<LegacyGitEntry[]> {
  if (!db) return [];
  const projects = await projectTree(db);
  if (!projects) return [];
  const project = child(projects, name);
  if (!project) return [];
  const git = child(project, '.git');
  if (!git) return [];
  const entries: LegacyGitEntry[] = [];
  const visit = async (node: LightningNode, path: string): Promise<void> => {
    const stat = node.get(0);
    if (!stat || stat instanceof Map) throw new Error(`Invalid legacy Git stat: ${path}`);
    if (stat.type === 'symlink') throw new Error(`Cannot migrate legacy Git symlink: ${path}`);
    if (stat.type === 'file') {
      if (!Number.isSafeInteger(stat.ino) || stat.ino < 0) {
        throw new Error(`Invalid legacy Git inode: ${path}`);
      }
      const data = await readValue<Uint8Array | ArrayBuffer>(db, 'pyxis-fs_files', stat.ino);
      if (!data) throw new Error(`Missing legacy Git bytes: ${path}`);
      if (!(data instanceof Uint8Array) && !(data instanceof ArrayBuffer)) {
        throw new Error(`Invalid legacy Git bytes: ${path}`);
      }
      const bytes = new Uint8Array(data);
      entries.push({ path, directory: false, bytes });
      return;
    }
    if (stat.type !== 'dir') throw new Error(`Invalid legacy Git type: ${path}`);
    entries.push({ path, directory: true });
    for (const [key, value] of node) {
      if (typeof key !== 'string') continue;
      if (!key || key === '.' || key === '..' || key.includes('/') || key.includes('\\')) {
        throw new Error(`Invalid legacy Git filename: ${path}/${key}`);
      }
      if (!(value instanceof Map)) throw new Error(`Invalid legacy Git entry: ${path}/${key}`);
      await visit(value, `${path}/${key}`);
    }
  };
  await visit(git, '/.git');
  return entries;
}
