/**
 * Tests for npm/CLI Infrastructure
 *
 * These tests validate the core npm and CLI execution infrastructure
 * that Pyxis uses to run npm packages.
 */

import {
  createTestContext,
  cleanupTestContext,
  createTestProject,
  createTestFile,
  createNpmProject,
  getTestProjectFiles,
  type TestContext,
} from '../testUtils';

describe('npm/CLI Infrastructure', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await createTestContext();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  describe('Project Setup', () => {
    it('should create an npm project with package.json', async () => {
      const { project, files } = await createNpmProject(ctx, 'test-npm-project', {
        dependencies: { lodash: '^4.17.21' },
      });

      expect(project.name).toBe('test-npm-project');
      expect(files.length).toBeGreaterThan(0);

      const packageJsonFile = files.find(f => f.path === '/package.json');
      expect(packageJsonFile).toBeDefined();
      expect(packageJsonFile?.content).toContain('lodash');
    });

    it('should create proper project structure', async () => {
      const { project, files } = await createNpmProject(ctx, 'structure-test');

      const paths = files.map(f => f.path);
      expect(paths).toContain('/package.json');
      expect(paths).toContain('/src');
      expect(paths).toContain('/src/index.js');
    });

    it('should store and retrieve files correctly', async () => {
      const { project } = await createNpmProject(ctx, 'storage-test');

      // Add more files
      await createTestFile(ctx, project.id, '/src/utils.js', 'export const add = (a, b) => a + b;');
      await createTestFile(ctx, project.id, '/src/config.json', '{"debug": true}');

      const allFiles = await getTestProjectFiles(ctx, project.id);
      expect(allFiles.length).toBe(5); // package.json, src/, src/index.js, utils.js, config.json
    });
  });

  describe('File Operations', () => {
    it('should update file content', async () => {
      const { project } = await createNpmProject(ctx, 'update-test');

      // Get the index.js file
      const files = await getTestProjectFiles(ctx, project.id);
      const indexFile = files.find(f => f.path === '/src/index.js');
      expect(indexFile).toBeDefined();

      // Update the content
      const updatedContent = 'console.log("Updated!");';
      indexFile!.content = updatedContent;
      await ctx.storage.files.save(indexFile!);

      // Verify update
      const updatedFile = await ctx.storage.files.getByPath(project.id, '/src/index.js');
      expect(updatedFile?.content).toBe(updatedContent);
    });

    it('should delete files', async () => {
      const { project } = await createNpmProject(ctx, 'delete-test');

      // Add a file to delete
      const tempFile = await createTestFile(ctx, project.id, '/temp.txt', 'Temporary file');

      // Verify it exists
      let allFiles = await getTestProjectFiles(ctx, project.id);
      expect(allFiles.find(f => f.path === '/temp.txt')).toBeDefined();

      // Delete the file
      await ctx.storage.files.delete(tempFile.id);

      // Verify it's gone
      allFiles = await getTestProjectFiles(ctx, project.id);
      expect(allFiles.find(f => f.path === '/temp.txt')).toBeUndefined();
    });

    it('should handle nested directory structure', async () => {
      const project = await createTestProject(ctx, 'nested-test');

      // Create nested structure
      await createTestFile(ctx, project.id, '/src', '', 'folder');
      await createTestFile(ctx, project.id, '/src/components', '', 'folder');
      await createTestFile(ctx, project.id, '/src/components/Button.tsx', 'export const Button = () => <button />;');
      await createTestFile(ctx, project.id, '/src/components/index.ts', 'export * from "./Button";');

      // Get files by prefix
      const srcFiles = await ctx.storage.files.getByPrefix(project.id, '/src');
      expect(srcFiles.length).toBe(4);

      const componentFiles = await ctx.storage.files.getByPrefix(project.id, '/src/components');
      expect(componentFiles.length).toBe(3); // folder + 2 files
    });
  });

  describe('Package.json Handling', () => {
    it('should parse dependencies from package.json', async () => {
      const { project } = await createNpmProject(ctx, 'deps-test', {
        dependencies: {
          react: '^18.2.0',
          'react-dom': '^18.2.0',
        },
        devDependencies: {
          typescript: '^5.0.0',
        },
      });

      const packageFile = await ctx.storage.files.getByPath(project.id, '/package.json');
      expect(packageFile).toBeDefined();

      const pkg = JSON.parse(packageFile!.content);
      expect(pkg.dependencies.react).toBe('^18.2.0');
      expect(pkg.devDependencies.typescript).toBe('^5.0.0');
    });

    it('should handle scripts in package.json', async () => {
      const { project } = await createNpmProject(ctx, 'scripts-test', {
        scripts: {
          build: 'tsc',
          test: 'jest',
          start: 'node dist/index.js',
        },
      });

      const packageFile = await ctx.storage.files.getByPath(project.id, '/package.json');
      const pkg = JSON.parse(packageFile!.content);

      expect(pkg.scripts.build).toBe('tsc');
      expect(pkg.scripts.test).toBe('jest');
      expect(pkg.scripts.start).toBe('node dist/index.js');
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple concurrent file creations', async () => {
      const project = await createTestProject(ctx, 'concurrent-test');

      // Create multiple files concurrently
      const filePromises = Array.from({ length: 10 }, (_, i) =>
        createTestFile(ctx, project.id, `/file${i}.txt`, `Content ${i}`)
      );

      await Promise.all(filePromises);

      const allFiles = await getTestProjectFiles(ctx, project.id);
      expect(allFiles.length).toBe(10);
    });

    it('should handle concurrent reads and writes', async () => {
      const { project } = await createNpmProject(ctx, 'rw-test');

      // Concurrent read and write operations
      const operations = [
        createTestFile(ctx, project.id, '/new1.txt', 'Content 1'),
        ctx.storage.files.getAllByProject(project.id),
        createTestFile(ctx, project.id, '/new2.txt', 'Content 2'),
        ctx.storage.files.getByPath(project.id, '/package.json'),
      ];

      const results = await Promise.all(operations);
      expect(results[3]).toBeDefined(); // package.json should be found
    });
  });
});
