/**
 * Extension Registry
 * public/extensions/registry.json を管理
 */

import { fetchExtensionManifest } from './extensionLoader';
import { extensionInfo, extensionError } from './extensionsLogger';
import type { ExtensionRegistry, ExtensionManifest } from './types';

const REGISTRY_URL = (process.env.NEXT_PUBLIC_BASE_PATH || '') + '/extensions/registry.json';

/**
 * キャッシュされたレジストリ
 */
let cachedRegistry: ExtensionRegistry | null = null;
let lastFetch: number = 0;
const CACHE_TTL = 1 * 60 * 1000; // 5分

/**
 * レジストリを取得
 */
export async function fetchRegistry(forceRefresh = false): Promise<ExtensionRegistry | null> {
  // キャッシュチェック
  if (!forceRefresh && cachedRegistry && Date.now() - lastFetch < CACHE_TTL) {
    extensionInfo('Using cached registry');
    return cachedRegistry;
  }

  try {
    extensionInfo(`Fetching registry from: ${REGISTRY_URL}`);
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      extensionError(`Failed to fetch registry: ${REGISTRY_URL} (${response.status})`);
      return null;
    }

    const registry = await response.json();
    extensionInfo(`Registry loaded successfully with ${registry.extensions.length} extensions`);
    cachedRegistry = registry;
    lastFetch = Date.now();

    return registry;
  } catch (error) {
    extensionError('Error fetching registry:', error);
    return null;
  }
}

/**
 * 利用可能な全ての拡張機能のマニフェストを取得
 */
export async function fetchAllManifests(): Promise<ExtensionManifest[]> {
  const registry = await fetchRegistry();
  if (!registry) {
    extensionError('Registry is null');
    return [];
  }

  extensionInfo(`Fetching all manifests for ${registry.extensions.length} extensions`);
  const manifests: ExtensionManifest[] = [];

  await Promise.all(
    registry.extensions.map(async entry => {
      try {
        const manifest = await fetchExtensionManifest(entry.manifestUrl);
        if (manifest) {
          manifests.push(manifest);
        }
      } catch (error) {
        extensionError(`Failed to load manifest from ${entry.manifestUrl}:`, error);
      }
    })
  );

  extensionInfo(`Successfully loaded ${manifests.length} manifests`);
  return manifests;
}

/**
 * 特定のタイプの拡張機能を取得
 */
export async function fetchManifestsByType(type: string): Promise<ExtensionManifest[]> {
  const registry = await fetchRegistry();
  if (!registry) {
    extensionError(`Registry is null (type: ${type})`);
    return [];
  }

  const entries = registry.extensions.filter(e => e.type === type);
  extensionInfo(`Found ${entries.length} extensions of type: ${type}`);

  const manifests: ExtensionManifest[] = [];

  await Promise.all(
    entries.map(async entry => {
      try {
        const manifest = await fetchExtensionManifest(entry.manifestUrl);
        if (manifest) {
          manifests.push(manifest);
        }
      } catch (error) {
        extensionError(`Failed to load manifest from ${entry.manifestUrl}:`, error);
      }
    })
  );

  extensionInfo(`Successfully loaded ${manifests.length} manifests of type: ${type}`);
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
