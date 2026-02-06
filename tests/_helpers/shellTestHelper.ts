/**
 * Shell test helper
 * Provides shared setup/teardown and assertion utilities for shell tests
 */

import { fileRepository } from '@/engine/core/fileRepository';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import type StreamShell from '@/engine/cmd/shell/streamShell';
import { setupTestProject } from './testProject';

export interface ShellTestContext {
  shell: StreamShell;
  projectId: string;
  projectName: string;
}

/**
 * Create a shell test context with a fresh project and shell instance.
 * Call `teardownShellTest()` in afterEach to clean up.
 */
export async function setupShellTest(name = 'ShellTest'): Promise<ShellTestContext> {
  const ctx = await setupTestProject(name);
  const unix = terminalCommandRegistry.getUnixCommands(ctx.projectName, ctx.projectId);
  const shell = (await terminalCommandRegistry.getShell(ctx.projectName, ctx.projectId, {
    unix,
    fileRepository,
  }))!;

  return {
    shell,
    projectId: ctx.projectId,
    projectName: ctx.projectName,
  };
}

/**
 * Clean up after a shell test.
 */
export async function teardownShellTest(): Promise<void> {
  await terminalCommandRegistry.clearAll();
}

/**
 * Create a file in the test project's virtual filesystem.
 * Path should be an app-relative path (e.g. "/script.sh").
 */
export async function createFile(projectId: string, path: string, content: string): Promise<void> {
  await fileRepository.createFile(projectId, path, content, 'file');
}

/**
 * Read a file's content from the test project's virtual filesystem.
 */
export async function readFile(projectId: string, path: string): Promise<string | null> {
  const file = await fileRepository.getFileByPath(projectId, path);
  return file?.content ?? null;
}
