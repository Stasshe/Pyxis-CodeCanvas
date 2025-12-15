/**
 * Data Migration Utilities
 * Export and import all Pyxis data (IndexedDB + localStorage) as ZIP
 */

import JSZip from 'jszip';
import { LOCALSTORAGE_KEY } from '@/context/config';

/**
 * Export all IndexedDB databases and localStorage to a ZIP file
 */
export async function exportAllData(): Promise<Blob> {
  const zip = new JSZip();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

  try {
    // 1. Export all IndexedDB databases
    const dbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);
    const indexedDBFolder = zip.folder('indexeddb');
    
    if (!indexedDBFolder) {
      throw new Error('Failed to create indexeddb folder in ZIP');
    }

    for (const dbInfo of dbs) {
      if (!dbInfo.name) continue;

      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = window.indexedDB.open(dbInfo.name!);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });

        const dbData: any = {
          name: dbInfo.name,
          version: db.version,
          stores: {},
        };

        const storeNames = Array.from(db.objectStoreNames);
        
        for (const storeName of storeNames) {
          try {
            const tx = db.transaction(storeName, 'readonly');
            const store = tx.objectStore(storeName);
            const items = await new Promise<any[]>((resolve, reject) => {
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result);
              req.onerror = () => reject(req.error);
            });
            
            dbData.stores[storeName] = items;
          } catch (error) {
            console.warn(`Failed to export store ${storeName} from ${dbInfo.name}:`, error);
          }
        }

        db.close();

        // Save database data as JSON
        const dbJson = JSON.stringify(dbData, null, 2);
        indexedDBFolder.file(`${dbInfo.name}.json`, dbJson);
      } catch (error) {
        console.warn(`Failed to export database ${dbInfo.name}:`, error);
      }
    }

    // 2. Export localStorage (all keys)
    const localStorageData: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        const value = localStorage.getItem(key);
        if (value !== null) {
          localStorageData[key] = value;
        }
      }
    }

    zip.file('localStorage.json', JSON.stringify(localStorageData, null, 2));

    // 3. Add metadata
    const metadata = {
      exportDate: new Date().toISOString(),
      version: process.env.NEXT_PUBLIC_PYXIS_VERSION || 'unknown',
      databaseCount: dbs.length,
      localStorageKeys: Object.keys(localStorageData).length,
    };

    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    // Generate ZIP blob
    const blob = await zip.generateAsync({ type: 'blob' });
    return blob;
  } catch (error) {
    console.error('[exportAllData] Failed to export data:', error);
    throw error;
  }
}

/**
 * Import data from a ZIP file and restore all databases and localStorage
 */
export async function importAllData(zipFile: File): Promise<void> {
  try {
    const zip = await JSZip.loadAsync(zipFile);

    // 1. Read metadata
    const metadataFile = zip.file('metadata.json');
    if (metadataFile) {
      const metadataStr = await metadataFile.async('string');
      const metadata = JSON.parse(metadataStr);
      console.log('[importAllData] Importing data from:', metadata.exportDate);
    }

    // 2. Clear all existing IndexedDB databases
    console.log('[importAllData] Clearing existing databases...');
    const existingDbs = await (window.indexedDB.databases ? window.indexedDB.databases() : []);
    
    for (const dbInfo of existingDbs) {
      if (!dbInfo.name) continue;
      
      try {
        await new Promise<void>((resolve, reject) => {
          const deleteReq = window.indexedDB.deleteDatabase(dbInfo.name!);
          deleteReq.onsuccess = () => resolve();
          deleteReq.onerror = () => reject(deleteReq.error);
          deleteReq.onblocked = () => {
            console.warn(`Database ${dbInfo.name} deletion blocked, continuing...`);
            resolve();
          };
        });
        console.log(`[importAllData] Deleted database: ${dbInfo.name}`);
      } catch (error) {
        console.warn(`[importAllData] Failed to delete database ${dbInfo.name}:`, error);
      }
    }

    // 3. Restore IndexedDB databases from ZIP
    const indexedDBFolder = zip.folder('indexeddb');
    if (indexedDBFolder) {
      const dbFiles: Array<{ name: string; file: JSZip.JSZipObject }> = [];
      
      indexedDBFolder.forEach((relativePath, file) => {
        if (relativePath.endsWith('.json')) {
          dbFiles.push({ name: relativePath, file });
        }
      });

      for (const { name, file } of dbFiles) {
        try {
          const dbDataStr = await file.async('string');
          const dbData = JSON.parse(dbDataStr);
          
          await restoreDatabase(dbData);
          console.log(`[importAllData] Restored database: ${dbData.name}`);
        } catch (error) {
          console.error(`[importAllData] Failed to restore database from ${name}:`, error);
        }
      }
    }

    // 4. Restore localStorage
    const localStorageFile = zip.file('localStorage.json');
    if (localStorageFile) {
      const localStorageStr = await localStorageFile.async('string');
      const localStorageData = JSON.parse(localStorageStr);
      
      // Clear existing localStorage
      localStorage.clear();
      
      // Restore all keys
      Object.entries(localStorageData).forEach(([key, value]) => {
        localStorage.setItem(key, value as string);
      });
      
      console.log(`[importAllData] Restored ${Object.keys(localStorageData).length} localStorage items`);
    }

    console.log('[importAllData] Data import completed successfully');
  } catch (error) {
    console.error('[importAllData] Failed to import data:', error);
    throw error;
  }
}

/**
 * Restore a single IndexedDB database from exported data
 */
async function restoreDatabase(dbData: any): Promise<void> {
  const { name, version, stores } = dbData;
  
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, version);
    
    request.onerror = () => reject(request.error);
    
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Create object stores
      Object.keys(stores).forEach(storeName => {
        if (!db.objectStoreNames.contains(storeName)) {
          // Try to detect keyPath from data
          const items = stores[storeName];
          let keyPath = 'id';
          
          if (items && items.length > 0 && items[0]) {
            // Check common key patterns
            if ('id' in items[0]) keyPath = 'id';
            else if ('key' in items[0]) keyPath = 'key';
            else if ('name' in items[0]) keyPath = 'name';
          }
          
          try {
            const objectStore = db.createObjectStore(storeName, { keyPath });
            
            // Create common indexes if they exist in the data
            if (items && items.length > 0 && items[0]) {
              if ('timestamp' in items[0]) {
                objectStore.createIndex('timestamp', 'timestamp', { unique: false });
              }
              if ('expiresAt' in items[0]) {
                objectStore.createIndex('expiresAt', 'expiresAt', { unique: false });
              }
            }
          } catch (error) {
            console.warn(`Failed to create object store ${storeName}:`, error);
          }
        }
      });
    };
    
    request.onsuccess = async () => {
      const db = request.result;
      
      try {
        // Populate stores with data
        for (const [storeName, items] of Object.entries(stores)) {
          if (!Array.isArray(items)) continue;
          
          const tx = db.transaction(storeName, 'readwrite');
          const store = tx.objectStore(storeName);
          
          for (const item of items) {
            try {
              await new Promise<void>((resolveItem, rejectItem) => {
                const addReq = store.put(item);
                addReq.onsuccess = () => resolveItem();
                addReq.onerror = () => rejectItem(addReq.error);
              });
            } catch (error) {
              console.warn(`Failed to add item to ${storeName}:`, error);
            }
          }
        }
        
        db.close();
        resolve();
      } catch (error) {
        db.close();
        reject(error);
      }
    };
  });
}

/**
 * Download a blob as a file
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
