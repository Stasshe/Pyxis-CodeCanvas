import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fsClient } from '@/engine/core/fs';
import type { FsCore } from '@/engine/core/fs/core';
import type {
  RuntimeExecutionOptions,
  RuntimeProvider,
} from '@/engine/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import { projectState } from '@/stores/projectStore';
import { createNodeRuntimeFixture } from '../../../_helpers/nodeRuntime';
import { setupTestProject } from '../../../_helpers/testProject';

describe('StreamShell node builtin', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    const context = await setupTestProject('ShellNodeBuiltinTest');
    rootPath = context.rootPath;
    repo = context.repo;
    projectState.currentRootPath = rootPath;
    vi.spyOn(fsClient, 'readFile').mockImplementation(path => repo.readFile(path));
    vi.spyOn(fsClient, 'readText').mockImplementation(path => repo.readText(path));
    vi.spyOn(fsClient, 'writeFile').mockImplementation((path, data) => repo.writeFile(path, data));
    vi.spyOn(fsClient, 'readdir').mockImplementation(path => repo.readdir(path));
    vi.spyOn(fsClient, 'stat').mockImplementation(path => repo.stat(path));
    vi.spyOn(fsClient, 'mkdir').mockImplementation((path, options) => repo.mkdir(path, options));
    vi.spyOn(fsClient, 'rm').mockImplementation((path, options) => repo.rm(path, options));
    vi.spyOn(fsClient, 'rename').mockImplementation((oldPath, newPath) =>
      repo.rename(oldPath, newPath)
    );
    vi.spyOn(fsClient, 'walk').mockImplementation(path => repo.walk(path));
    vi.spyOn(fsClient, 'exists').mockImplementation(path => repo.exists(path));
    runtimeRegistry.registerRuntime(createTestRuntimeProvider(repo));
  });

  afterEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    projectState.currentRootPath = null;
    vi.restoreAllMocks();
  });

  it('executes a JavaScript file passed as a relative path from the project root', async () => {
    await repo.writeFile(
      `${rootPath}/src/relative-node-entry.js`,
      "console.log('relative entry ok');"
    );

    const shell = await terminalCommandRegistry.getShell(rootPath);
    const result = await shell!.run('node src/relative-node-entry.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('Cannot find module');
    expect(result.stdout).toContain('relative entry ok');
  });

  it('sets process.cwd() to the terminal working directory', async () => {
    await repo.writeFile(`${rootPath}/src/cwd-node-entry.js`, 'console.log(process.cwd());');

    const shell = await terminalCommandRegistry.getShell(rootPath);
    await shell!.run('cd src');
    const result = await shell!.run('node cwd-node-entry.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${rootPath}/src`);
  });

  it('exposes runtime process.cwd() through global objects', async () => {
    await repo.writeFile(
      `${rootPath}/src/global-cwd-node-entry.js`,
      [
        'console.log(global.process.cwd());',
        'console.log(globalThis.process.cwd());',
        "console.log(require('process').cwd());",
      ].join('\n')
    );

    const shell = await terminalCommandRegistry.getShell(rootPath);
    await shell!.run('cd src');
    const result = await shell!.run('node global-cwd-node-entry.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.match(new RegExp(rootPath + '/src', 'g'))).toHaveLength(3);
  });
});

function createTestRuntimeProvider(repo: FsCore): RuntimeProvider {
  return {
    id: 'nodejs',
    name: 'Node.js test runtime',
    supportedExtensions: ['.js', '.mjs', '.cjs'],
    canExecute: path => /\.(js|mjs|cjs)$/.test(path),
    async execute(options: RuntimeExecutionOptions) {
      const fixture = await createNodeRuntimeFixture(
        options.rootPath,
        options.debugConsole,
        options.cwd
      );
      try {
        for (const entry of await repo.walk(options.rootPath)) {
          if (entry.type === 'file') {
            await fixture.writeFile(entry.path, await repo.readFile(entry.path));
          }
        }
        await fixture.runtime.execute(options.filePath, options.argv);
        await fixture.runtime.waitForEventLoop();
        return { exitCode: fixture.runtime.getExitCode() };
      } finally {
        fixture.close();
      }
    },
  };
}
