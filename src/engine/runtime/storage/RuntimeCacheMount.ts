import type { MountStat, VirtualMount } from './types';

interface CacheRecord {
  key: string;
  value: string | ArrayBuffer;
  mtime: number;
  isDir: boolean;
}

function contentSize(content: string | Uint8Array): number {
  return typeof content === 'string' ? new TextEncoder().encode(content).length : content.length;
}

function toArrayBuffer(content: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(content.byteLength);
  copy.set(content);
  return copy.buffer;
}

export class RuntimeCacheMount implements VirtualMount {
  private hotCache = new Map<string, string | Uint8Array>();
  private hotDirs = new Set<string>(['/cache']);
  private db: IDBDatabase | null = null;
  private initPromise: Promise<void> | null = null;
  private readonly storeName = 'runtimeCache';
  private readonly dbName = 'PyxisProjects';
  private readonly dbVersion = 6;

  constructor(private readonly namespace = 'global') {}

  async init(): Promise<void> {
    if (this.db) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        this.db = await this.openDB();
        await this.loadAll();
      })();
    }
    await this.initPromise;
  }

  private async ensureReady(): Promise<IDBDatabase> {
    await this.init();
    if (!this.db) {
      throw new Error('RuntimeCacheMount database is not initialized');
    }
    return this.db;
  }

  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, this.dbVersion);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = event => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: 'key' });
        }
      };
    });
  }

  private async loadAll(): Promise<void> {
    const records = await this.idbGetAll();
    for (const record of records) {
      const path = this.fromStorageKey(record.key);
      if (!path) continue;

      if (record.isDir) {
        this.hotDirs.add(path);
        continue;
      }
      const value =
        record.value instanceof ArrayBuffer ? new Uint8Array(record.value) : record.value;
      this.hotCache.set(path, value);
    }
  }

  private toStorageKey(path: string): string {
    return `${this.namespace}:${path}`;
  }

  private fromStorageKey(key: string): string | null {
    const prefix = `${this.namespace}:`;
    if (!key.startsWith(prefix)) return null;
    return key.slice(prefix.length);
  }

  private async idbGetAll(): Promise<CacheRecord[]> {
    const db = await this.ensureReadyForTransaction();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result as CacheRecord[]);
      req.onerror = () => reject(req.error);
    });
  }

  private ensureReadyForTransaction(): Promise<IDBDatabase> {
    if (!this.db) {
      throw new Error('RuntimeCacheMount database is not initialized');
    }
    return Promise.resolve(this.db);
  }

  private async idbPut(record: CacheRecord): Promise<void> {
    const db = await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private async idbDelete(key: string): Promise<void> {
    const db = await this.ensureReady();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  hasFile(path: string): boolean {
    return this.hotCache.has(path);
  }

  hasDir(path: string): boolean {
    return this.hotDirs.has(path);
  }

  getFileSync(path: string): string | Uint8Array | undefined {
    return this.hotCache.get(path);
  }

  async getFile(path: string): Promise<string | Uint8Array | undefined> {
    await this.init();
    return this.hotCache.get(path);
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    this.hotCache.set(path, content);
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current = `${current}/${part}`;
      this.hotDirs.add(current);
      await this.idbPut({
        key: this.toStorageKey(current),
        value: '',
        mtime: Date.now(),
        isDir: true,
      });
    }
    await this.idbPut({
      key: this.toStorageKey(path),
      value: typeof content === 'string' ? content : toArrayBuffer(content),
      mtime: Date.now(),
      isDir: false,
    });
  }

  async deleteFile(path: string): Promise<boolean> {
    if (!this.hotCache.has(path)) return false;
    this.hotCache.delete(path);
    await this.idbDelete(this.toStorageKey(path));
    return true;
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      const parts = path.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = `${current}/${part}`;
        this.hotDirs.add(current);
        await this.idbPut({
          key: this.toStorageKey(current),
          value: '',
          mtime: Date.now(),
          isDir: true,
        });
      }
      return;
    }
    this.hotDirs.add(path);
    await this.idbPut({ key: this.toStorageKey(path), value: '', mtime: Date.now(), isDir: true });
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      for (const key of [...this.hotCache.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
          this.hotCache.delete(key);
          await this.idbDelete(this.toStorageKey(key));
        }
      }
      for (const key of [...this.hotDirs]) {
        if (key === path || key.startsWith(`${path}/`)) {
          this.hotDirs.delete(key);
          await this.idbDelete(this.toStorageKey(key));
        }
      }
      return;
    }
    this.hotDirs.delete(path);
    await this.idbDelete(this.toStorageKey(path));
  }

  async listDir(path: string): Promise<string[]> {
    await this.init();
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const p of [...this.hotDirs, ...this.hotCache.keys()]) {
      if (p.startsWith(prefix) && p !== path) {
        names.add(p.slice(prefix.length).split('/')[0]);
      }
    }
    return [...names].filter(Boolean);
  }

  async stat(path: string): Promise<MountStat | null> {
    await this.init();
    if (this.hotDirs.has(path)) return { type: 'directory', size: 0, mtime: new Date() };
    const content = this.hotCache.get(path);
    if (content === undefined) return null;
    return { type: 'file', size: contentSize(content), mtime: new Date() };
  }

  async clear(): Promise<void> {
    await this.ensureReady();
    const keys = [...this.hotCache.keys(), ...this.hotDirs].map(key => this.toStorageKey(key));
    this.hotCache.clear();
    this.hotDirs.clear();
    this.hotDirs.add('/cache');
    await Promise.all(keys.map(key => this.idbDelete(key)));
  }
}
