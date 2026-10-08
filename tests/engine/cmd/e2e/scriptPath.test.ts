import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fsClient } from '@/engine/core/fs';
import type { FsCore } from '@/engine/core/fs/core';
import { initialFileContents } from '@/engine/initialFileContents';
import type {
  RuntimeExecutionOptions,
  RuntimeProvider,
} from '@/engine/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import { projectState } from '@/stores/projectStore';
import { createNodeRuntimeFixture } from '../../../_helpers/nodeRuntime';
import { setupTestProject } from '../../../_helpers/testProject';

describe('script path execution', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    const context = await setupTestProject('Script Path Integration');
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

  it.each([
    ['project root', './src/run-test.sh', ''],
    ['script directory', 'cd src && ./run-test.sh', '/src'],
  ])(
    'runs the unchanged fixture from the %s in a workspace with spaces',
    async (_cwd, command, expectedShellCwd) => {
      const src = initialFileContents.src;
      if (src.type !== 'folder') throw new Error('Initial src directory is missing');
      expect(await repo.readText(`${rootPath}/src/run-test.sh`)).toBe(
        src.children['run-test.sh'].content
      );

      const shell = await terminalCommandRegistry.getShell(rootPath);
      const result = await shell.run(command);
      const cwd = await shell.run('pwd');

      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toContain('== run-test.sh: Environment ==');
      expect(result.stdout).toContain(`PWD: ${rootPath}`);
      expect(result.stdout).toContain('---\n');
      for (let count = 1; count <= 5; count += 1) {
        expect(result.stdout).toContain(`カウント: ${count}`);
      }
      expect(result.stdout).toContain('Hello, World!');
      expect(result.stdout).toContain('二乗した配列: [\n  1,\n  4,\n  9,\n  16\n]');
      expect(result.stdout).toContain('1 + 2 = 3');
      expect(result.stdout).toContain('3 * 4 = 12');
      expect(result.stdout).toContain('3秒経ちました。');
      expect(result.stdout).toContain('run-test.sh finished successfully');
      expect(cwd.code, cwd.stderr).toBe(0);
      expect(cwd.stdout.trim()).toBe(`${rootPath}${expectedShellCwd}`);
    },
    30000
  );

  it('stops on a failing Node entry and preserves the parent shell directory', async () => {
    await repo.writeFile(
      `${rootPath}/src/fail.js`,
      "console.error('node fixture failed'); process.exit(23);"
    );
    await repo.writeFile(
      `${rootPath}/fail-fast.sh`,
      '#!/usr/bin/env bash\nset -euo pipefail\nnode src/fail.js\necho "unreachable final marker"\n'
    );
    const shell = await terminalCommandRegistry.getShell(rootPath);

    const result = await shell.run('bash fail-fast.sh');
    const cwd = await shell.run('pwd');

    expect(result.code).toBe(23);
    expect(result.stderr).toContain('node fixture failed');
    expect(result.stdout).not.toContain('unreachable final marker');
    expect(cwd.code, cwd.stderr).toBe(0);
    expect(cwd.stdout.trim()).toBe(rootPath);
  }, 30000);
});

function createTestRuntimeProvider(repo: FsCore): RuntimeProvider {
  return {
    id: 'nodejs',
    name: 'Node.js script path test runtime',
    supportedExtensions: ['.js', '.mjs', '.cjs'],
    canExecute: path => /\.(js|mjs|cjs)$/.test(path),
    async execute(options: RuntimeExecutionOptions) {
      const fixture = await createNodeRuntimeFixture(
        options.rootPath,
        options.debugConsole,
        options.cwd,
        undefined,
        undefined,
        { onStdout: options.onStdout, onStderr: options.onStderr }
      );
      const forwardInput = (bytes: Uint8Array) => fixture.stdin.submit(bytes);
      const endInput = () => fixture.stdin.eof();
      options.processStdin?.on('data', forwardInput);
      options.processStdin?.on('end', endInput);
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
        options.processStdin?.removeListener('data', forwardInput);
        options.processStdin?.removeListener('end', endInput);
        fixture.close();
      }
    },
  };
}
