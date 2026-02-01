/**
 * Tests for the In-Memory Storage Adapter
 *
 * These tests validate the in-memory storage implementation
 * that will be used for Node.js testing.
 */

import { InMemoryStorageAdapter } from '../../../src/engine/core/storage/inMemoryAdapter';
import type { Project, ProjectFile, ChatSpace } from '../../../src/types';

describe('InMemoryStorageAdapter', () => {
  let adapter: InMemoryStorageAdapter;

  beforeEach(async () => {
    adapter = new InMemoryStorageAdapter({ debug: false });
    await adapter.init();
  });

  afterEach(async () => {
    await adapter.close();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(adapter.isInitialized()).toBe(true);
    });

    it('should close successfully', async () => {
      await adapter.close();
      expect(adapter.isInitialized()).toBe(false);
    });
  });

  describe('projects', () => {
    const createProject = (id: string, name: string): Project => ({
      id,
      name,
      description: `Description for ${name}`,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should save and retrieve a project', async () => {
      const project = createProject('proj-1', 'Test Project');
      await adapter.projects.save(project);

      const retrieved = await adapter.projects.getById('proj-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Test Project');
    });

    it('should get all projects', async () => {
      await adapter.projects.save(createProject('proj-1', 'Project 1'));
      await adapter.projects.save(createProject('proj-2', 'Project 2'));

      const all = await adapter.projects.getAll();
      expect(all.length).toBe(2);
    });

    it('should get project by name', async () => {
      await adapter.projects.save(createProject('proj-1', 'Unique Name'));

      const found = await adapter.projects.getByName('Unique Name');
      expect(found).not.toBeNull();
      expect(found?.id).toBe('proj-1');
    });

    it('should return null for non-existent project', async () => {
      const found = await adapter.projects.getById('non-existent');
      expect(found).toBeNull();
    });

    it('should delete a project', async () => {
      await adapter.projects.save(createProject('proj-1', 'To Delete'));
      await adapter.projects.delete('proj-1');

      const found = await adapter.projects.getById('proj-1');
      expect(found).toBeNull();
    });
  });

  describe('files', () => {
    const createFile = (
      id: string,
      projectId: string,
      path: string,
      type: 'file' | 'folder' = 'file'
    ): ProjectFile => ({
      id,
      projectId,
      path,
      name: path.split('/').pop() || '',
      content: type === 'file' ? `Content of ${path}` : '',
      type,
      parentPath: path.substring(0, path.lastIndexOf('/')) || '/',
      createdAt: new Date(),
      updatedAt: new Date(),
      isBufferArray: false,
    });

    it('should save and retrieve a file', async () => {
      const file = createFile('file-1', 'proj-1', '/src/main.ts');
      await adapter.files.save(file);

      const retrieved = await adapter.files.getById('file-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.path).toBe('/src/main.ts');
    });

    it('should get all files for a project', async () => {
      await adapter.files.save(createFile('file-1', 'proj-1', '/src/a.ts'));
      await adapter.files.save(createFile('file-2', 'proj-1', '/src/b.ts'));
      await adapter.files.save(createFile('file-3', 'proj-2', '/src/c.ts'));

      const proj1Files = await adapter.files.getAllByProject('proj-1');
      expect(proj1Files.length).toBe(2);

      const proj2Files = await adapter.files.getAllByProject('proj-2');
      expect(proj2Files.length).toBe(1);
    });

    it('should get file by path', async () => {
      await adapter.files.save(createFile('file-1', 'proj-1', '/src/main.ts'));

      const found = await adapter.files.getByPath('proj-1', '/src/main.ts');
      expect(found).not.toBeNull();
      expect(found?.id).toBe('file-1');
    });

    it('should get files by prefix', async () => {
      await adapter.files.save(createFile('file-1', 'proj-1', '/src/a.ts'));
      await adapter.files.save(createFile('file-2', 'proj-1', '/src/b.ts'));
      await adapter.files.save(createFile('file-3', 'proj-1', '/lib/c.ts'));

      const srcFiles = await adapter.files.getByPrefix('proj-1', '/src');
      expect(srcFiles.length).toBe(2);

      const allFiles = await adapter.files.getByPrefix('proj-1', '/');
      expect(allFiles.length).toBe(3);
    });

    it('should delete a file', async () => {
      await adapter.files.save(createFile('file-1', 'proj-1', '/to-delete.ts'));
      await adapter.files.delete('file-1');

      const found = await adapter.files.getById('file-1');
      expect(found).toBeNull();
    });

    it('should delete all files for a project', async () => {
      await adapter.files.save(createFile('file-1', 'proj-1', '/a.ts'));
      await adapter.files.save(createFile('file-2', 'proj-1', '/b.ts'));
      await adapter.files.deleteByProject('proj-1');

      const files = await adapter.files.getAllByProject('proj-1');
      expect(files.length).toBe(0);
    });
  });

  describe('chatSpaces', () => {
    const createChatSpace = (id: string, projectId: string, name: string): ChatSpace => ({
      id,
      projectId,
      name,
      messages: [],
      selectedFiles: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    it('should save and retrieve a chat space', async () => {
      const chatSpace = createChatSpace('chat-1', 'proj-1', 'Main Chat');
      await adapter.chatSpaces.save(chatSpace);

      const retrieved = await adapter.chatSpaces.getById('proj-1', 'chat-1');
      expect(retrieved).not.toBeNull();
      expect(retrieved?.name).toBe('Main Chat');
    });

    it('should get all chat spaces for a project', async () => {
      await adapter.chatSpaces.save(createChatSpace('chat-1', 'proj-1', 'Chat 1'));
      await adapter.chatSpaces.save(createChatSpace('chat-2', 'proj-1', 'Chat 2'));

      const spaces = await adapter.chatSpaces.getAllByProject('proj-1');
      expect(spaces.length).toBe(2);
    });

    it('should delete a chat space', async () => {
      await adapter.chatSpaces.save(createChatSpace('chat-1', 'proj-1', 'To Delete'));
      await adapter.chatSpaces.delete('proj-1', 'chat-1');

      const found = await adapter.chatSpaces.getById('proj-1', 'chat-1');
      expect(found).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all data', async () => {
      await adapter.projects.save({
        id: 'proj-1',
        name: 'Test',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await adapter.files.save({
        id: 'file-1',
        projectId: 'proj-1',
        path: '/test.ts',
        name: 'test.ts',
        content: '',
        type: 'file',
        parentPath: '/',
        createdAt: new Date(),
        updatedAt: new Date(),
        isBufferArray: false,
      });

      adapter.clear();

      const projects = await adapter.projects.getAll();
      const files = await adapter.files.getAllByProject('proj-1');

      expect(projects.length).toBe(0);
      expect(files.length).toBe(0);
    });
  });
});
