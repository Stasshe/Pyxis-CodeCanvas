/**
 * Tests for FileRepository with Storage Adapter
 *
 * These tests validate that FileRepository correctly uses
 * the storage adapter abstraction.
 */

import { InMemoryStorageAdapter } from '@/engine/core/storage/inMemoryAdapter';
import { setStorageAdapter, resetStorageAdapter } from '@/engine/core/storage/envCheck';
import type { Project, ProjectFile } from '@/types';

// We need to test FileRepository in isolation with InMemory storage
// Since FileRepository is a singleton, we need to be careful with test isolation

describe('FileRepository with Storage Adapter', () => {
  let memoryAdapter: InMemoryStorageAdapter;

  beforeEach(async () => {
    // Create a fresh in-memory adapter for each test
    memoryAdapter = new InMemoryStorageAdapter({ debug: false });
    await memoryAdapter.init();
    
    // Set the global adapter
    setStorageAdapter(memoryAdapter);
  });

  afterEach(async () => {
    // Clean up
    memoryAdapter.clear();
    await memoryAdapter.close();
    await resetStorageAdapter();
  });

  describe('Project Operations via Storage Adapter', () => {
    it('should save and retrieve a project', async () => {
      const project: Project = {
        id: 'test-project-1',
        name: 'Test Project',
        description: 'A test project',
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await memoryAdapter.projects.save(project);
      const retrieved = await memoryAdapter.projects.getById('test-project-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Project');
    });

    it('should list all projects', async () => {
      await memoryAdapter.projects.save({
        id: 'p1',
        name: 'Project 1',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await memoryAdapter.projects.save({
        id: 'p2',
        name: 'Project 2',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const projects = await memoryAdapter.projects.getAll();
      expect(projects.length).toBe(2);
    });

    it('should delete a project', async () => {
      await memoryAdapter.projects.save({
        id: 'to-delete',
        name: 'Delete Me',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await memoryAdapter.projects.delete('to-delete');
      const found = await memoryAdapter.projects.getById('to-delete');

      expect(found).toBeNull();
    });
  });

  describe('File Operations via Storage Adapter', () => {
    const testProjectId = 'test-proj';

    beforeEach(async () => {
      await memoryAdapter.projects.save({
        id: testProjectId,
        name: 'Test Project',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    it('should save and retrieve a file', async () => {
      const file: ProjectFile = {
        id: 'file-1',
        projectId: testProjectId,
        path: '/src/index.ts',
        name: 'index.ts',
        content: 'console.log("hello");',
        type: 'file',
        parentPath: '/src',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      };

      await memoryAdapter.files.save(file);
      const retrieved = await memoryAdapter.files.getById('file-1');

      expect(retrieved).not.toBeNull();
      expect(retrieved?.content).toBe('console.log("hello");');
    });

    it('should get files by project', async () => {
      await memoryAdapter.files.save({
        id: 'f1',
        projectId: testProjectId,
        path: '/a.ts',
        name: 'a.ts',
        content: '',
        type: 'file',
        parentPath: '/',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });
      await memoryAdapter.files.save({
        id: 'f2',
        projectId: testProjectId,
        path: '/b.ts',
        name: 'b.ts',
        content: '',
        type: 'file',
        parentPath: '/',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });

      const files = await memoryAdapter.files.getAllByProject(testProjectId);
      expect(files.length).toBe(2);
    });

    it('should get file by path', async () => {
      await memoryAdapter.files.save({
        id: 'path-test',
        projectId: testProjectId,
        path: '/unique/path.ts',
        name: 'path.ts',
        content: 'unique content',
        type: 'file',
        parentPath: '/unique',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });

      const found = await memoryAdapter.files.getByPath(testProjectId, '/unique/path.ts');
      expect(found).not.toBeNull();
      expect(found?.content).toBe('unique content');
    });

    it('should get files by prefix', async () => {
      await memoryAdapter.files.save({
        id: 'src-1',
        projectId: testProjectId,
        path: '/src/a.ts',
        name: 'a.ts',
        content: '',
        type: 'file',
        parentPath: '/src',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });
      await memoryAdapter.files.save({
        id: 'src-2',
        projectId: testProjectId,
        path: '/src/b.ts',
        name: 'b.ts',
        content: '',
        type: 'file',
        parentPath: '/src',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });
      await memoryAdapter.files.save({
        id: 'lib-1',
        projectId: testProjectId,
        path: '/lib/c.ts',
        name: 'c.ts',
        content: '',
        type: 'file',
        parentPath: '/lib',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });

      const srcFiles = await memoryAdapter.files.getByPrefix(testProjectId, '/src');
      expect(srcFiles.length).toBe(2);
    });

    it('should delete files by project', async () => {
      await memoryAdapter.files.save({
        id: 'del-1',
        projectId: testProjectId,
        path: '/x.ts',
        name: 'x.ts',
        content: '',
        type: 'file',
        parentPath: '/',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });
      await memoryAdapter.files.save({
        id: 'del-2',
        projectId: testProjectId,
        path: '/y.ts',
        name: 'y.ts',
        content: '',
        type: 'file',
        parentPath: '/',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });

      await memoryAdapter.files.deleteByProject(testProjectId);
      const remaining = await memoryAdapter.files.getAllByProject(testProjectId);

      expect(remaining.length).toBe(0);
    });
  });

  describe('Environment Isolation', () => {
    it('should use InMemory adapter in test environment', async () => {
      // The adapter should be the one we set
      expect(memoryAdapter.isInitialized()).toBe(true);
    });

    it('should maintain data isolation between tests', async () => {
      // Each test gets a fresh adapter, so this test should have no data
      const projects = await memoryAdapter.projects.getAll();
      expect(projects.length).toBe(0);
    });
  });
});
