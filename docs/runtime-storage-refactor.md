# Runtime Storage 分離 実装仕様

## 目的

`fsModule.ts` の責務過多を解消し、`/tmp` と `/cache` を project file tree から完全に分離する。

- `/tmp` → MemoryMount (揮発性、Mapのみ)
- `/cache` → RuntimeCacheMount (IDB専用 object store `runtimeCache`、project tree 混入しない)
- fsModule → path normalize + mount dispatch + Node.js API shim のみ

後方互換性不要。レガシーコード削除。

---

## 新規ファイル

### `src/engine/runtime/storage/types.ts`

```typescript
export interface MountStat {
  type: 'file' | 'directory';
  size: number;
  mtime: Date;
}

export interface VirtualMount {
  // 同期 (メモリ問い合わせのみ)
  hasFile(path: string): boolean;
  hasDir(path: string): boolean;
  getFileSync(path: string): string | Uint8Array | undefined;

  // 非同期
  getFile(path: string): Promise<string | Uint8Array | undefined>;
  setFile(path: string, content: string | Uint8Array): Promise<void>;
  deleteFile(path: string): Promise<boolean>;
  mkdir(path: string, recursive?: boolean): Promise<void>;
  rmdir(path: string, recursive?: boolean): Promise<void>;
  listDir(path: string): Promise<string[]>;
  stat(path: string): Promise<MountStat | null>;
}
```

---

### `src/engine/runtime/storage/MemoryMount.ts`

`/tmp` 専用。揮発性。IDB一切使わない。

```typescript
import type { VirtualMount, MountStat } from './types';

export class MemoryMount implements VirtualMount {
  private files = new Map<string, string | Uint8Array>();
  private dirs = new Set<string>();

  constructor(rootPath: string) {
    this.dirs.add(rootPath);
  }

  hasFile(path: string): boolean { return this.files.has(path); }
  hasDir(path: string): boolean { return this.dirs.has(path); }
  getFileSync(path: string): string | Uint8Array | undefined { return this.files.get(path); }

  async getFile(path: string): Promise<string | Uint8Array | undefined> {
    return this.files.get(path);
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    // 親ディレクトリを自動作成
    const parts = path.split('/').filter(Boolean);
    let current = '';
    for (const part of parts.slice(0, -1)) {
      current = `${current}/${part}`;
      this.dirs.add(current);
    }
    this.files.set(path, content);
  }

  async deleteFile(path: string): Promise<boolean> {
    return this.files.delete(path);
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      const parts = path.split('/').filter(Boolean);
      let current = '';
      for (const part of parts) {
        current = `${current}/${part}`;
        this.dirs.add(current);
      }
    } else {
      this.dirs.add(path);
    }
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      for (const key of [...this.files.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
      }
      for (const key of [...this.dirs]) {
        if (key === path || key.startsWith(`${path}/`)) this.dirs.delete(key);
      }
    } else {
      this.dirs.delete(path);
    }
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = path.endsWith('/') ? path : `${path}/`;
    const names = new Set<string>();
    for (const p of [...this.dirs, ...this.files.keys()]) {
      if (p.startsWith(prefix) && p !== path) {
        names.add(p.slice(prefix.length).split('/')[0]);
      }
    }
    return [...names].filter(Boolean);
  }

  async stat(path: string): Promise<MountStat | null> {
    if (this.dirs.has(path)) return { type: 'directory', size: 0, mtime: new Date() };
    const content = this.files.get(path);
    if (content === undefined) return null;
    const size = typeof content === 'string'
      ? new TextEncoder().encode(content).length
      : content.length;
    return { type: 'file', size, mtime: new Date() };
  }
}
```

---

### `src/engine/runtime/storage/RuntimeCacheMount.ts`

`/cache` 専用。IDB `runtimeCache` object store を直接使う。`fileRepository` は使わない。

IDB store schema: `{ key: string (path), value: string | ArrayBuffer }`

```typescript
import type { VirtualMount, MountStat } from './types';

interface CacheRecord {
  key: string;
  value: string | ArrayBuffer;
  mtime: number;
  isDir: boolean;
}

export class RuntimeCacheMount implements VirtualMount {
  private hotCache = new Map<string, string | Uint8Array>();
  private hotDirs = new Set<string>();
  private db: IDBDatabase | null = null;
  private readonly storeName = 'runtimeCache';
  private readonly dbName = 'PyxisProjects';
  private readonly dbVersion = 6; // 5→6: runtimeCache store 追加

  async init(): Promise<void> {
    this.db = await this.openDB();
    await this.loadAll();
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
      if (record.isDir) {
        this.hotDirs.add(record.key);
      } else {
        const value = record.value instanceof ArrayBuffer
          ? new Uint8Array(record.value)
          : record.value as string;
        this.hotCache.set(record.key, value);
      }
    }
  }

  private idbGetAll(): Promise<CacheRecord[]> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readonly');
      const req = tx.objectStore(this.storeName).getAll();
      req.onsuccess = () => resolve(req.result as CacheRecord[]);
      req.onerror = () => reject(req.error);
    });
  }

  private idbPut(record: CacheRecord): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).put(record);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  private idbDelete(key: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).delete(key);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  hasFile(path: string): boolean { return this.hotCache.has(path); }
  hasDir(path: string): boolean { return this.hotDirs.has(path); }
  getFileSync(path: string): string | Uint8Array | undefined { return this.hotCache.get(path); }

  async getFile(path: string): Promise<string | Uint8Array | undefined> {
    return this.hotCache.get(path);
  }

  async setFile(path: string, content: string | Uint8Array): Promise<void> {
    this.hotCache.set(path, content);
    // 親ディレクトリ
    const parts = path.split('/').filter(Boolean);
    let cur = '';
    for (const part of parts.slice(0, -1)) {
      cur = `${cur}/${part}`;
      this.hotDirs.add(cur);
      await this.idbPut({ key: cur, value: '', mtime: Date.now(), isDir: true });
    }
    const value = typeof content === 'string'
      ? content
      : content.buffer instanceof ArrayBuffer ? content.buffer : content.buffer as ArrayBuffer;
    await this.idbPut({ key: path, value, mtime: Date.now(), isDir: false });
  }

  async deleteFile(path: string): Promise<boolean> {
    if (!this.hotCache.has(path)) return false;
    this.hotCache.delete(path);
    await this.idbDelete(path);
    return true;
  }

  async mkdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      const parts = path.split('/').filter(Boolean);
      let cur = '';
      for (const part of parts) {
        cur = `${cur}/${part}`;
        this.hotDirs.add(cur);
        await this.idbPut({ key: cur, value: '', mtime: Date.now(), isDir: true });
      }
    } else {
      this.hotDirs.add(path);
      await this.idbPut({ key: path, value: '', mtime: Date.now(), isDir: true });
    }
  }

  async rmdir(path: string, recursive = false): Promise<void> {
    if (recursive) {
      for (const key of [...this.hotCache.keys()]) {
        if (key === path || key.startsWith(`${path}/`)) {
          this.hotCache.delete(key);
          await this.idbDelete(key);
        }
      }
      for (const key of [...this.hotDirs]) {
        if (key === path || key.startsWith(`${path}/`)) {
          this.hotDirs.delete(key);
          await this.idbDelete(key);
        }
      }
    } else {
      this.hotDirs.delete(path);
      await this.idbDelete(path);
    }
  }

  async listDir(path: string): Promise<string[]> {
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
    if (this.hotDirs.has(path)) return { type: 'directory', size: 0, mtime: new Date() };
    const content = this.hotCache.get(path);
    if (content === undefined) return null;
    const size = typeof content === 'string'
      ? new TextEncoder().encode(content).length
      : content.length;
    return { type: 'file', size, mtime: new Date() };
  }

  /** キャッシュ全消去 (セッション跨ぎ不要なキャッシュをクリアするとき) */
  async clear(): Promise<void> {
    this.hotCache.clear();
    this.hotDirs.clear();
    return new Promise((resolve, reject) => {
      const tx = this.db!.transaction(this.storeName, 'readwrite');
      const req = tx.objectStore(this.storeName).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }
}
```

---

### `src/engine/runtime/storage/MountRouter.ts`

```typescript
import type { VirtualMount } from './types';

interface MountEntry {
  prefix: string;
  mount: VirtualMount;
}

export class MountRouter {
  private mounts: MountEntry[];
  private fallback: VirtualMount;

  constructor(mounts: MountEntry[], fallback: VirtualMount) {
    // 長いprefixを優先 (より具体的なマッチを先に)
    this.mounts = [...mounts].sort((a, b) => b.prefix.length - a.prefix.length);
    this.fallback = fallback;
  }

  resolve(path: string): VirtualMount {
    for (const { prefix, mount } of this.mounts) {
      if (path === prefix || path.startsWith(`${prefix}/`)) return mount;
    }
    return this.fallback;
  }
}
```

---

## 変更ファイル

### `src/engine/core/fileRepository/indexeddb.ts`

`version` を 5 → 6 に変更し、`onupgradeneeded` に追加:

```typescript
private version = 6; // 5→6: runtimeCache object store 追加
```

`onupgradeneeded` 内の既存ストア作成コードの後に追加:

```typescript
if (!db.objectStoreNames.contains('runtimeCache')) {
  db.createObjectStore('runtimeCache', { keyPath: 'key' });
}
```

**注意**: `RuntimeCacheMount` が自前で `indexedDB.open` する際に version 6 を指定するため、`fileRepository` 側も version を合わせる必要がある。両方が同じ `PyxisProjects` DBを開くので version は統一すること。

---

### `src/engine/runtime/nodejs/modules/fsModule.ts`

**削除するもの:**
- `const tmpRoot = '/tmp'`
- `const tmpFiles = new Map<>()`
- `const tmpDirs = new Set<>()`
- `function isTmpPath()`
- `function ensureTmpParents()`
- `const memoryCache = new Map<>()`
- `const knownDirs = new Set<>()`
- `function rememberPath()`

**`FSModuleOptions` に追加:**
```typescript
import type { MountRouter } from '@/engine/runtime/storage/MountRouter';

export interface FSModuleOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
  mountRouter: MountRouter;  // 追加
}
```

**`createFSModule` 冒頭で受け取る:**
```typescript
export function createFSModule(options: FSModuleOptions) {
  const { projectDir, projectId, projectName, mountRouter } = options;
  // ...
}
```

**各 fs 操作の書き換えパターン:**

`isTmpPath(relativePath)` の分岐を全て削除し、`mountRouter.resolve(relativePath)` で mount を取得して委譲する。

例: `readFile` の場合
```typescript
// Before
if (isTmpPath(relativePath)) {
  if (!tmpFiles.has(relativePath)) throw createFsError('ENOENT', 'open', path);
  return formatReadContent(tmpFiles.get(relativePath)!, normalized.options);
}
if (memoryCache.has(relativePath)) {
  return formatReadContent(memoryCache.get(relativePath)!, normalized.options);
}
const file = await fileRepository.getFileByPath(projectId, relativePath);
// ...
memoryCache.set(relativePath, content);

// After
const mount = mountRouter.resolve(relativePath);
const syncContent = mount.getFileSync(relativePath);
if (syncContent !== undefined) {
  return formatReadContent(syncContent, normalized.options);
}
// ProjectMount (fallback) の場合のみ IDB フォールスルー
const file = await fileRepository.getFileByPath(projectId, relativePath);
if (!file) throw createFsError('ENOENT', 'open', path);
const content = file.content ?? '';
await mount.setFile(relativePath, content); // ProjectMount の memoryCache 更新
return formatReadContent(content, normalized.options);
```

**ProjectMount について:**

ProjectMount は新規クラスとして切り出す必要はない。fsModule 内の `fileRepository` + メモリキャッシュのロジックは、fallback mount のインライン実装として残してよい。ただし `MountRouter.resolve()` が `/tmp`, `/cache` 以外を返す「fallback」として機能する構造にすること。

あるいは、`ProjectMount` を `VirtualMount` 実装として `fsModule.ts` 内にローカルクラスで定義し、fallback として `MountRouter` に渡す方法でもよい。どちらでも可。

**書き換えが必要な全メソッド一覧:**
- `getStats` / `getStatsSync`
- `readFile` / `readFileSync`
- `writeFile` / `writeFileSync`
- `existsSync`
- `accessSync`
- `preloadFiles` (memoryCache → ProjectMount へのロード)
- `mkdir` / `mkdirSync`
- `readdir` / `readdirSync`
- `unlink`
- `rmSync`

---

### `src/engine/runtime/module/moduleCache.ts`

**削除するもの:**
- `import { fileRepository }` と関連する全使用箇所
- `private cacheDir = '/cache/modules'`
- `private metaDir = '/cache/meta'`
- `private async ensureCacheDirectories()`
- `private async loadAllCacheFromDisk()`
- `private async saveToDisk()`
- `private async deleteFromDisk()`

**追加するもの:**
```typescript
import { RuntimeCacheMount } from '@/engine/runtime/storage/RuntimeCacheMount';
```

`constructor` に `cacheMount: RuntimeCacheMount` を受け取るよう変更:
```typescript
constructor(projectId: string, projectName: string, cacheMount: RuntimeCacheMount) {
  this.projectId = projectId;
  this.projectName = projectName;
  this.cacheMount = cacheMount;
}
```

`init()` は `cacheMount.init()` の完了を待つだけでよい (loadAll は RuntimeCacheMount.init() 内で実行済み)。ただし既存の `this.cache: Map` は `hotCache` として維持 — `cacheMount` は永続化バックエンドとして使う。

`set()`:
```typescript
// saveToDisk の代わりに
const metaKey = `/cache/meta/${safeFileName}.json`;
const codeKey = `/cache/modules/${safeFileName}.js`;
await this.cacheMount.setFile(codeKey, entry.code);
await this.cacheMount.setFile(metaKey, JSON.stringify(meta));
```

`loadAllCacheFromDisk` の代わり: `init()` 内で `cacheMount` の hotCache/hotDirs から再構築:
```typescript
private async loadFromMount(): Promise<void> {
  const metaFiles = await this.cacheMount.listDir('/cache/meta');
  for (const name of metaFiles) {
    if (!name.endsWith('.json')) continue;
    const metaContent = this.cacheMount.getFileSync(`/cache/meta/${name}`);
    if (!metaContent) continue;
    // ... parse and rebuild this.cache
  }
}
```

`deleteFromDisk` の代わり:
```typescript
private async deleteFromMount(path: string): Promise<void> {
  const safeFileName = this.pathToSafeFileName(path);
  await this.cacheMount.deleteFile(`/cache/modules/${safeFileName}.js`);
  await this.cacheMount.deleteFile(`/cache/meta/${safeFileName}.json`);
}
```

---

### `src/engine/runtime/nodejs/builtInModule.ts`

`createBuiltInModules` に `mountRouter` を受け取るよう変更:

```typescript
import type { MountRouter } from '@/engine/runtime/storage/MountRouter';

export interface BuiltInModulesOptions {
  // 既存フィールド...
  mountRouter: MountRouter; // 追加
}

export function createBuiltInModules(options: BuiltInModulesOptions): BuiltInModules {
  const { ..., mountRouter } = options;
  return {
    fs: createFSModule({ projectDir, projectId, projectName, mountRouter }),
    // 他は変更なし
  };
}
```

---

### `src/engine/runtime/nodejs/nodeRuntime.ts`

`NodeRuntime` クラス (または `NodeRuntimeProvider`) の初期化処理に追加:

```typescript
import { MemoryMount } from '@/engine/runtime/storage/MemoryMount';
import { RuntimeCacheMount } from '@/engine/runtime/storage/RuntimeCacheMount';
import { MountRouter } from '@/engine/runtime/storage/MountRouter';

// run() または constructor の中で:
const tmpMount = new MemoryMount('/tmp');
const cacheMount = new RuntimeCacheMount();
await cacheMount.init(); // IDB から hotCache をロード

const mountRouter = new MountRouter(
  [
    { prefix: '/tmp', mount: tmpMount },
    { prefix: '/cache', mount: cacheMount },
  ],
  projectMount // fallback: ProjectMount or inline IDB logic
);

// createBuiltInModules に mountRouter を渡す
this.builtInModules = createBuiltInModules({
  ...,
  mountRouter,
});

// ModuleCache も cacheMount を使う
this.moduleCache = new ModuleCache(projectId, projectName, cacheMount);
await this.moduleCache.init();
```

`projectMount` (fallback) は fsModule 内のインライン `fileRepository` ロジックをそのまま使う形でよい。`MountRouter.resolve()` が fallback を返したとき、fsModule は既存の IDB アクセスコードを実行する。

---

## 削除されるデータ

既存の IDB `files` store に存在する `/cache/modules/` と `/cache/meta/` 以下のエントリは移行しない。初回起動時にキャッシュは空になり、再transpile が走る。その後は `runtimeCache` store に蓄積される。

---

## 実装完了の確認基準

1. `git status` で `/cache/` フォルダがプロジェクトツリーに出現しない
2. `npm install` 実行後、`/tmp` 以下のファイルが IDB `files` store に存在しない
3. ページリロード後、`runtimeCache` store に前回の transpile cache が残っている
4. `moduleCache.ts` が `fileRepository` を import していない
5. `fsModule.ts` に `tmpFiles`, `tmpDirs`, `isTmpPath`, `ensureTmpParents` が存在しない
