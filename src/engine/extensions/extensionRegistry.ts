/**
 * Extension Registry
 * public/extensions/registry.json を管理
 */

import type { ExtensionRegistry, ExtensionManifest } from './types';
import { fetchExtensionManifest } from './extensionLoader';

const REGISTRY_URL = '/extensions/registry.json';

/**
 * キャッシュされたレジストリ
 */
let cachedRegistry: ExtensionRegistry | null = null;
let lastFetch: number = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分

/**
 * レジストリを取得
 */
export async function fetchRegistry(forceRefresh = false): Promise<ExtensionRegistry | null> {
  // キャッシュチェック
  if (!forceRefresh && cachedRegistry && Date.now() - lastFetch < CACHE_TTL) {
    return cachedRegistry;
  }

  try {
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      console.error(`[ExtensionRegistry] Failed to fetch registry (${response.status})`);
      return null;
    }

    const registry = await response.json();
    cachedRegistry = registry;
    lastFetch = Date.now();

    return registry;
  } catch (error) {
    console.error('[ExtensionRegistry] Error fetching registry:', error);
    return null;
  }
}

/**
 * 利用可能な全ての拡張機能のマニフェストを取得
 */
export async function fetchAllManifests(): Promise<ExtensionManifest[]> {
  const registry = await fetchRegistry();
  if (!registry) return [];

  const manifests: ExtensionManifest[] = [];

  await Promise.all(
    registry.extensions.map(async entry => {
      const manifest = await fetchExtensionManifest(entry.manifestUrl);
      if (manifest) {
        manifests.push(manifest);
      }
    })
  );

  return manifests;
}

/**
 * 特定のタイプの拡張機能を取得
 */
export async function fetchManifestsByType(
  type: string
): Promise<ExtensionManifest[]> {
  const registry = await fetchRegistry();
  if (!registry) return [];

  const entries = registry.extensions.filter(e => e.type === type);

  const manifests: ExtensionManifest[] = [];

  await Promise.all(
    entries.map(async entry => {
      const manifest = await fetchExtensionManifest(entry.manifestUrl);
      if (manifest) {
        manifests.push(manifest);
      }
    })
  );

  return manifests;
}

/**
 * デフォルトで有効化すべき拡張機能のリストを取得
 */
export async function getDefaultEnabledExtensions(): Promise<string[]> {
  const registry = await fetchRegistry();
  if (!registry) return [];

  return registry.extensions.filter(e => e.defaultEnabled).map(e => e.manifestUrl);
}

/**
 * 推奨拡張機能のリストを取得
 */
export async function getRecommendedExtensions(): Promise<string[]> {
  const registry = await fetchRegistry();
  if (!registry) return [];

  return registry.extensions.filter(e => e.recommended).map(e => e.manifestUrl);
}
