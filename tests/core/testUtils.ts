/**
 * Test Utilities for Pyxis Testing
 *
 * This module provides utilities for setting up test environments,
 * including mocking storage and file system operations.
 */

import { InMemoryStorageAdapter } from '@/engine/core/storage/inMemoryAdapter';
import type { IStorageAdapter } from '@/engine/core/storage/types';
import type { Project, ProjectFile } from '@/types';

/**
 * Test Context
 *
 * Holds the test environment state including the storage adapter
 * and any test-specific configurations.
 */
export interface TestContext {
  storage: InMemoryStorageAdapter;
  currentProject?: Project;
}

/**
 * Create a test context with an initialized in-memory storage
 */
export async function createTestContext(): Promise<TestContext> {
  const storage = new InMemoryStorageAdapter({ debug: false });
  await storage.init();
  return { storage };
}

/**
 * Cleanup a test context
 */
export async function cleanupTestContext(ctx: TestContext): Promise<void> {
  ctx.storage.clear();
  await ctx.storage.close();
}

/**
 * Generate a unique ID for testing
 */
export function generateTestId(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substr(2, 12);
  return `${prefix}_${timestamp}_${random}`;
}

/**
 * Create a test project in the storage
 */
export async function createTestProject(
  ctx: TestContext,
  name: string,
  description?: string
): Promise<Project> {
  const project: Project = {
    id: generateTestId('project'),
    name,
    description,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await ctx.storage.projects.save(project);
  ctx.currentProject = project;
  return project;
}

/**
 * Create a test file in the storage
 */
export async function createTestFile(
  ctx: TestContext,
  projectId: string,
  path: string,
  content: string,
  type: 'file' | 'folder' = 'file'
): Promise<ProjectFile> {
  const file: ProjectFile = {
    id: generateTestId('file'),
    projectId,
    path,
    name: path.split('/').pop() || '',
    content: type === 'file' ? content : '',
    type,
    parentPath: path.substring(0, path.lastIndexOf('/')) || '/',
    createdAt: new Date(),
    updatedAt: new Date(),
    isBufferArray: false,
  };
  await ctx.storage.files.save(file);
  return file;
}

/**
 * Get all files for a test project
 */
export async function getTestProjectFiles(
  ctx: TestContext,
  projectId: string
): Promise<ProjectFile[]> {
  return ctx.storage.files.getAllByProject(projectId);
}

/**
 * Mock package.json content for testing
 */
export function createPackageJson(config: {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, string>;
}): string {
  return JSON.stringify(
    {
      name: config.name || 'test-project',
      version: config.version || '1.0.0',
      dependencies: config.dependencies || {},
      devDependencies: config.devDependencies || {},
      scripts: config.scripts || {},
    },
    null,
    2
  );
}

/**
 * Create a basic npm project structure in storage
 */
export async function createNpmProject(
  ctx: TestContext,
  projectName: string,
  packageConfig?: Parameters<typeof createPackageJson>[0]
): Promise<{ project: Project; files: ProjectFile[] }> {
  const project = await createTestProject(ctx, projectName);
  const files: ProjectFile[] = [];

  // Create package.json
  const packageJson = await createTestFile(
    ctx,
    project.id,
    '/package.json',
    createPackageJson(packageConfig || { name: projectName })
  );
  files.push(packageJson);

  // Create src directory
  const srcDir = await createTestFile(ctx, project.id, '/src', '', 'folder');
  files.push(srcDir);

  // Create index.js
  const indexJs = await createTestFile(
    ctx,
    project.id,
    '/src/index.js',
    `// ${projectName} entry point\nconsole.log("Hello from ${projectName}!");\n`
  );
  files.push(indexJs);

  return { project, files };
}
