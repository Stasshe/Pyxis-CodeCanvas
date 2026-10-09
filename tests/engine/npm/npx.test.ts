import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import { handleNPXCommand } from '@/engine/cmd/handlers/npmHandler';
import { resolveLocalBinary } from '@/engine/cmd/shell/localBinary';
import { ProcessStdin } from '@/engine/cmd/terminalProcessBridge';
import { fsClient } from '@/engine/core/fs';
import type { FsCore } from '@/engine/core/fs/core';
import type {
  RuntimeExecutionOptions,
  RuntimeProvider,
} from '@/engine/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import { projectState } from '@/stores/projectStore';
import { createNpmRuntimeFixture } from '../../_helpers/npmRuntime';
import { getTestFs } from '../../_helpers/testFs';
import { testFsFiles } from '../../_helpers/testFsFiles';
import { setupTestProject } from '../../_helpers/testProject';

describe('handleNPXCommand', () => {
  let rootPath: string;
  let repo: FsCore;

  beforeEach(async () => {
    const ctx = await setupTestProject('NpxCommandTest');
    rootPath = ctx.rootPath;
    repo = ctx.repo;
    projectState.currentRootPath = rootPath;
    runtimeRegistry.clear();
    vi.spyOn(fsClient, 'readText').mockImplementation(path => repo.readText(path));
    vi.spyOn(fsClient, 'exists').mockImplementation(path => repo.exists(path));
    runtimeRegistry.registerRuntime(createTestRuntimeProvider(repo));
  });

  afterEach(() => {
    runtimeRegistry.clear();
    projectState.currentRootPath = null;
    vi.restoreAllMocks();
  });

  async function installFakePrettier(): Promise<void> {
    await testFsFiles.createFile(
      rootPath,
      '/node_modules/prettier/package.json',
      JSON.stringify({
        name: 'prettier',
        version: '3.8.3',
        bin: {
          prettier: './bin/prettier.cjs',
        },
      }),
      'file'
    );

    await testFsFiles.createFile(
      rootPath,
      '/node_modules/prettier/bin/prettier.cjs',
      [
        'global.__entryStarted = true;',
        'module.exports.__promise = Promise.resolve()',
        "  .then(() => require('../internal/legacy-cli.js'))",
        '  .then(cli => cli.run());',
      ].join('\n'),
      'file'
    );

    await testFsFiles.createFile(
      rootPath,
      '/node_modules/prettier/internal/legacy-cli.js',
      [
        'module.exports.run = async function run() {',
        'if (!global.__entryStarted) {',
        "  throw new Error('legacy-cli executed during dependency preload');",
        '}',
        'const args = process.argv.slice(2);',
        "if (args.includes('--version')) {",
        "  console.log('3.8.3');",
        '  return;',
        '}',
        "require('fs').readFile('/tmp/ionstore_tiny-updater.json', () => {});",
        "console.error('Expected at least one target file/dir/glob');",
        'process.exit(1);',
        '};',
      ].join('\n'),
      'file'
    );

    const installer = new NpmInstall(rootPath, getTestFs());
    await installer.ensureBinsForPackage('prettier');
  }

  it('does not execute CLI dependencies during preload for --version', async () => {
    await installFakePrettier();

    const output: string[] = [];
    const code = await handleNPXCommand(
      ['prettier', '--version'],
      async text => {
        output.push(text);
      },
      new ProcessStdin()
    );

    const combined = output.join('');
    expect(code).toBe(0);
    expect(combined).toContain('3.8.3');
    expect(combined).not.toContain('Expected at least one target file/dir/glob');
    expect(combined).not.toContain('legacy-cli executed during dependency preload');
    expect(combined).not.toContain('Failed to run prettier:');
    expect(combined).not.toContain('[object Object]');
  });

  it('preserves normal CLI failure output for non-version invocation', async () => {
    await installFakePrettier();

    const output: string[] = [];
    const code = await handleNPXCommand(
      ['prettier'],
      async text => {
        output.push(text);
      },
      new ProcessStdin()
    );

    const combined = output.join('');
    expect(code).toBe(1);
    expect(combined).toContain('Expected at least one target file/dir/glob');
    expect(combined).not.toContain('legacy-cli executed during dependency preload');
  });

  it('does not resolve a package by its name when it has no matching bin link', async () => {
    await testFsFiles.createFile(
      rootPath,
      '/node_modules/package-only/package.json',
      JSON.stringify({ name: 'package-only', bin: { 'different-command': './bin.js' } }),
      'file'
    );
    await testFsFiles.createFile(rootPath, '/node_modules/package-only/bin.js', 'void 0;', 'file');

    const output: string[] = [];
    const code = await handleNPXCommand(
      ['package-only'],
      async text => {
        output.push(text);
      },
      new ProcessStdin()
    );

    const combined = output.join('');
    expect(code).toBe(127);
    expect(combined).toContain('package-only: command not found');
  });

  it('finds an ancestor .bin link from nested working directories', async () => {
    await repo.mkdir(`${rootPath}/node_modules/.bin`, { recursive: true });
    await testFsFiles.createFile(rootPath, '/node_modules/typescript/bin/tsc.js', '', 'file');
    await repo.rm(`${rootPath}/node_modules/.bin/tsc`, { recursive: true, force: true });
    await repo.symlink('../typescript/bin/tsc.js', `${rootPath}/node_modules/.bin/tsc`);
    await repo.mkdir(`${rootPath}/packages/app/src`, { recursive: true });

    const path = await resolveLocalBinary('tsc', `${rootPath}/packages/app/src`, repo);

    expect(path).toBe(`${rootPath}/node_modules/.bin/tsc`);
  });
});

function createTestRuntimeProvider(repo: FsCore): RuntimeProvider {
  return {
    id: 'nodejs',
    name: 'Node.js test runtime',
    supportedExtensions: ['.js', '.mjs', '.cjs'],
    canExecute: filePath => /\.(js|mjs|cjs)$/.test(filePath),
    async execute(options: RuntimeExecutionOptions) {
      const fixture = await createNpmRuntimeFixture(
        repo,
        options.rootPath,
        options.debugConsole,
        options.cwd
      );
      try {
        await fixture.runtime.execute(options.filePath, options.argv);
        await fixture.runtime.waitForEventLoop();
        return { exitCode: fixture.runtime.getExitCode() };
      } finally {
        fixture.close();
      }
    },
  };
}
