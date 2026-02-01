/**
 * Storage Layer Module
 *
 * This module provides a unified storage abstraction layer that can work
 * with different backends:
 * - IndexedDB for browser production
 * - In-Memory for Node.js testing
 *
 * Usage:
 * ```typescript
 * import { getStorageAdapter } from '@/engine/core/storage';
 *
 * const adapter = await getStorageAdapter();
 * const projects = await adapter.projects.getAll();
 * ```
 */

// Types
export type {
  IStorageAdapter,
  IProjectStore,
  IFileStore,
  IChatSpaceStore,
  StorageEnvironment,
  StorageConfig,
} from './types';

// Environment detection
export {
  detectEnvironment,
  isBrowser,
  isNode,
  isTest,
  getStorageAdapter,
  createStorageAdapter,
  resetStorageAdapter,
  setStorageAdapter,
} from './envCheck';

// Adapters (for direct use when needed)
export { InMemoryStorageAdapter } from './inMemoryAdapter';
export { IndexedDBStorageAdapter } from './indexedDBAdapter';
