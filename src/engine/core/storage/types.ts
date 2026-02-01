/**
 * Storage Layer Type Definitions
 *
 * This module defines the interfaces for the storage abstraction layer.
 * The storage layer provides a unified interface for data persistence
 * that can be implemented by different backends (IndexedDB, In-Memory, etc.)
 */

import type { Project, ProjectFile, ChatSpace } from '@/types';

/**
 * Project Store Interface
 * Handles project-level CRUD operations
 */
export interface IProjectStore {
  /** Get all projects */
  getAll(): Promise<Project[]>;
  /** Get a project by ID */
  getById(id: string): Promise<Project | null>;
  /** Get a project by name */
  getByName(name: string): Promise<Project | null>;
  /** Save a project (create or update) */
  save(project: Project): Promise<void>;
  /** Delete a project by ID */
  delete(id: string): Promise<void>;
}

/**
 * File Store Interface
 * Handles file-level CRUD operations
 */
export interface IFileStore {
  /** Get all files for a project */
  getAllByProject(projectId: string): Promise<ProjectFile[]>;
  /** Get files by prefix path */
  getByPrefix(projectId: string, prefix: string): Promise<ProjectFile[]>;
  /** Get a file by ID */
  getById(id: string): Promise<ProjectFile | null>;
  /** Get a file by path within a project */
  getByPath(projectId: string, path: string): Promise<ProjectFile | null>;
  /** Save a file (create or update) */
  save(file: ProjectFile): Promise<void>;
  /** Delete a file by ID */
  delete(id: string): Promise<void>;
  /** Delete all files for a project */
  deleteByProject(projectId: string): Promise<void>;
}

/**
 * ChatSpace Store Interface (Optional - for compatibility)
 * Handles chat space operations
 */
export interface IChatSpaceStore {
  /** Get all chat spaces for a project */
  getAllByProject(projectId: string): Promise<ChatSpace[]>;
  /** Get a chat space by ID */
  getById(projectId: string, id: string): Promise<ChatSpace | null>;
  /** Save a chat space */
  save(chatSpace: ChatSpace): Promise<void>;
  /** Delete a chat space */
  delete(projectId: string, id: string): Promise<void>;
  /** Delete all chat spaces for a project */
  deleteByProject(projectId: string): Promise<void>;
}

/**
 * Storage Adapter Interface
 * Main interface that combines all store interfaces
 */
export interface IStorageAdapter {
  /** Project operations */
  readonly projects: IProjectStore;
  /** File operations */
  readonly files: IFileStore;
  /** Chat space operations (optional for Node.js testing) */
  readonly chatSpaces?: IChatSpaceStore;

  /** Initialize the storage adapter */
  init(): Promise<void>;
  /** Close/cleanup the storage adapter */
  close(): Promise<void>;
  /** Check if the adapter is initialized */
  isInitialized(): boolean;
}

/**
 * Storage Environment Type
 */
export type StorageEnvironment = 'browser' | 'node' | 'test';

/**
 * Storage Configuration
 */
export interface StorageConfig {
  /** Database name (for IndexedDB) */
  dbName?: string;
  /** Database version */
  version?: number;
  /** Enable debug logging */
  debug?: boolean;
}
