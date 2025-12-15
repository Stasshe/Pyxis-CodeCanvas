/**
 * Extension Storage Adapter
 * 拡張機能データをIndexedDBに保存するアダプター
 */

import { dataUrlToBlob } from './binaryUtils';
import type { InstalledExtension } from './types';

import { STORES, storageService } from '@/engine/storage';

/**
 * インストール済み拡張機能をIndexedDBに保存
 */
export async function saveInstalledExtension(extension: InstalledExtension): Promise<void> {
  if (!extension.manifest) {
    throw new Error('Cannot save extension: manifest is null or undefined');
  }
  // Convert any data URL strings inside extension.cache.files to Blobs to avoid storing large base64 strings
  try {
    if (extension.cache && extension.cache.files) {
      for (const [key, value] of Object.entries(extension.cache.files)) {
        if (typeof value === 'string' && value.startsWith('data:')) {
          try {
            (extension.cache.files as Record<string, string | Blob>)[key] = dataUrlToBlob(value);
          } catch (e) {
            console.warn('[saveInstalledExtension] Failed to convert data URL to Blob for', key, e);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[saveInstalledExtension] Error normalizing files before save:', e);
  }

  // For extension entries, avoid caching binary payloads in memory by default
  await storageService.set(STORES.EXTENSIONS, extension.manifest.id, extension, { cache: false });
}

/**
 * インストール済み拡張機能を取得
 */
export async function loadInstalledExtension(
  extensionId: string
): Promise<InstalledExtension | null> {
  return await storageService.get<InstalledExtension>(STORES.EXTENSIONS, extensionId);
}

/**
 * 全てのインストール済み拡張機能を取得
 */
export async function loadAllInstalledExtensions(): Promise<InstalledExtension[]> {
  const entries = await storageService.getAll<InstalledExtension>(STORES.EXTENSIONS);
  // manifestがnull/undefinedのものは除外
  return entries.map(entry => entry.data).filter(ext => ext && ext.manifest);
}

/**
 * 拡張機能を削除
 */
export async function deleteInstalledExtension(extensionId: string): Promise<void> {
  await storageService.delete(STORES.EXTENSIONS, extensionId);
}

/**
 * 全ての拡張機能データをクリア
 */
export async function clearAllExtensions(): Promise<void> {
  await storageService.clear(STORES.EXTENSIONS);
}
