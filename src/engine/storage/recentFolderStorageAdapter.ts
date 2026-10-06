import { IDB } from '@/constants/idb';
import type { Project } from '@/types';

interface RecentFolderRecord {
  rootPath: string;
  name: string;
  updatedAt: Date;
}

const DB_NAME = IDB.RECENT_FOLDERS.NAME;
const DB_VERSION = IDB.RECENT_FOLDERS.VERSION;
const STORE_NAME = 'recent_folders';

let databasePromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise;

  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'rootPath' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error);
    };
  });

  return databasePromise;
}

export async function closeRecentFolders(): Promise<void> {
  const pendingDatabase = databasePromise;
  if (!pendingDatabase) return;
  const database = await pendingDatabase;
  database.close();
  if (databasePromise === pendingDatabase) databasePromise = null;
}

export async function listRecentFolders(): Promise<Project[]> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readonly');
  const request = transaction.objectStore(STORE_NAME).getAll();
  const records = await new Promise<RecentFolderRecord[]>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as RecentFolderRecord[]);
    request.onerror = () => reject(request.error);
  });

  return records
    .map(record => ({ ...record, updatedAt: new Date(record.updatedAt) }))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export async function saveRecentFolder(project: Project): Promise<void> {
  const database = await openDatabase();
  const record: RecentFolderRecord = {
    rootPath: project.rootPath,
    name: project.name,
    updatedAt: new Date(),
  };
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const request = transaction.objectStore(STORE_NAME).put(record);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    request.onerror = () => reject(request.error);
  });
}

export async function removeRecentFolder(rootPath: string): Promise<void> {
  const database = await openDatabase();
  const transaction = database.transaction(STORE_NAME, 'readwrite');
  const request = transaction.objectStore(STORE_NAME).delete(rootPath);
  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
    transaction.onerror = () => reject(transaction.error);
    request.onerror = () => reject(request.error);
  });
}
