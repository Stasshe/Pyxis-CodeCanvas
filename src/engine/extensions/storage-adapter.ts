/**
 * Extension Storage Adapter
 * 拡張機能データをIndexedDBに保存するアダプター
 */

import { storageService, STORES } from '@/engine/storage';
import type { InstalledExtension, ExtensionManifest } from './types';

/**
 * インストール済み拡張機能をIndexedDBに保存
 */
export async function saveInstalledExtension(extension: InstalledExtension): Promise<void> {
  await storageService.set(STORES.EXTENSIONS, extension.manifest.id, extension);
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
  return entries.map(entry => entry.data);
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
