/**
 * Environment Detection Module
 *
 * This module detects the current runtime environment and provides
 * the appropriate storage adapter.
 */

import type { IStorageAdapter, StorageEnvironment, StorageConfig } from './types';

/**
 * Detect the current runtime environment
 */
export function detectEnvironment(): StorageEnvironment {
  // Check for Node.js test environment (Jest, Vitest, etc.)
  if (typeof process !== 'undefined' && process.env) {
    if (process.env.NODE_ENV === 'test' || process.env.JEST_WORKER_ID !== undefined) {
      return 'test';
    }
  }

  // Check for Node.js runtime (no window, no IndexedDB)
  if (typeof window === 'undefined') {
    return 'node';
  }

  // Check if IndexedDB is available
  if (typeof indexedDB === 'undefined') {
    return 'node';
  }

  // Default to browser
  return 'browser';
}

/**
 * Check if running in a browser environment
 */
export function isBrowser(): boolean {
  return detectEnvironment() === 'browser';
}

/**
 * Check if running in a Node.js environment
 */
export function isNode(): boolean {
  const env = detectEnvironment();
  return env === 'node' || env === 'test';
}

/**
 * Check if running in a test environment
 */
export function isTest(): boolean {
  return detectEnvironment() === 'test';
}

/**
 * Storage Adapter Factory
 *
 * This is the global storage adapter instance. It is lazily initialized
 * based on the detected environment.
 */
let globalAdapter: IStorageAdapter | null = null;
let adapterInitPromise: Promise<IStorageAdapter> | null = null;

/**
 * Create a storage adapter for the detected environment
 */
export async function createStorageAdapter(config?: StorageConfig): Promise<IStorageAdapter> {
  const env = detectEnvironment();

  if (env === 'browser') {
    const { IndexedDBStorageAdapter } = await import('./indexedDBAdapter');
    return new IndexedDBStorageAdapter(config);
  }

  // Node.js or test environment - use in-memory storage
  const { InMemoryStorageAdapter } = await import('./inMemoryAdapter');
  return new InMemoryStorageAdapter(config);
}

/**
 * Get the global storage adapter instance
 *
 * This function returns the same adapter instance across multiple calls.
 * The adapter is automatically created and initialized on first call.
 */
export async function getStorageAdapter(config?: StorageConfig): Promise<IStorageAdapter> {
  if (globalAdapter && globalAdapter.isInitialized()) {
    return globalAdapter;
  }

  if (adapterInitPromise) {
    return adapterInitPromise;
  }

  adapterInitPromise = (async () => {
    const adapter = await createStorageAdapter(config);
    await adapter.init();
    globalAdapter = adapter;
    return adapter;
  })();

  return adapterInitPromise;
}

/**
 * Reset the global storage adapter (for testing)
 */
export async function resetStorageAdapter(): Promise<void> {
  if (globalAdapter) {
    await globalAdapter.close();
    globalAdapter = null;
  }
  adapterInitPromise = null;
}

/**
 * Set a custom storage adapter (for testing)
 */
export function setStorageAdapter(adapter: IStorageAdapter): void {
  globalAdapter = adapter;
  adapterInitPromise = Promise.resolve(adapter);
}
