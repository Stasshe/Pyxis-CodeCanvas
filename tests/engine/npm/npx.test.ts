import { beforeEach, describe, expect, it } from 'vitest';
import { NpmInstall } from '@/engine/cmd/global/npmOperations/npmInstall';
import { handleNPXCommand } from '@/engine/cmd/handlers/npmHandler';
import { fileRepository } from '@/engine/core/fileRepository';
import { setupTestProject } from '../../_helpers/testProject';

describe('handleNPXCommand', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    const ctx = await setupTestProject('NpxCommandTest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  async function installFakePrettier(): Promise<void> {
    await fileRepository.createFile(
      projectId,
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

    await fileRepository.createFile(
      projectId,
      '/node_modules/prettier/bin/prettier.cjs',
      [
        'global.__entryStarted = true;',
        "module.exports.__promise = Promise.resolve()",
        "  .then(() => require('../internal/legacy-cli.js'))",
        '  .then(cli => cli.run());',
      ].join('\n'),
      'file'
    );

    await fileRepository.createFile(
      projectId,
      '/node_modules/prettier/internal/legacy-cli.js',
      [
        'module.exports.run = async function run() {',
        'if (!global.__entryStarted) {',
        "  throw new Error('legacy-cli executed during dependency preload');",
        '}',
        "const args = process.argv.slice(2);",
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

    const installer = new NpmInstall(projectName, projectId, true);
    await installer.ensureBinsForPackage('prettier');

    // Simulate an old stale shim left behind from a previous build.
    await fileRepository.createFile(
      projectId,
      '/node_modules/.bin/prettier',
      [
        '#!/usr/bin/env node',
        'try {',
        "  require('../prettier/bin/prettier.cjs');",
        '} catch (e) {',
        "  console.error('Failed to run prettier:', e && e.message ? e.message : e);",
        '  process.exit(1);',
        '}',
      ].join('\n'),
      'file'
    );
  }

  it('does not execute CLI dependencies during preload for --version', async () => {
    await installFakePrettier();

    const output: string[] = [];
    const code = await handleNPXCommand(
      ['prettier', '--version'],
      projectName,
      projectId,
      async text => {
        output.push(text);
      }
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
    const code = await handleNPXCommand(['prettier'], projectName, projectId, async text => {
      output.push(text);
    });

    const combined = output.join('');
    expect(code).toBe(1);
    expect(combined).toContain('Expected at least one target file/dir/glob');
    expect(combined).not.toContain('legacy-cli executed during dependency preload');
  });

  it('does not fall back to a stale .bin shim when package bin exists', async () => {
    await installFakePrettier();

    await fileRepository.createFile(
      projectId,
      '/node_modules/.bin/prettier',
      [
        '#!/usr/bin/env node',
        "console.error('stale shim should not run');",
        'process.exit(1);',
      ].join('\n'),
      'file'
    );

    const output: string[] = [];
    const code = await handleNPXCommand(
      ['prettier', '--version'],
      projectName,
      projectId,
      async text => {
        output.push(text);
      }
    );

    const combined = output.join('');
    expect(code).toBe(0);
    expect(combined).toContain('3.8.3');
    expect(combined).not.toContain('stale shim should not run');
  });
});
