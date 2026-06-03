import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';
import { setupTestProject } from '../../../_helpers/testProject';

describe('StreamShell node builtin', () => {
  let projectId: string;
  let projectName: string;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const ctx = await setupTestProject('ShellNodeBuiltinTest');
    projectId = ctx.projectId;
    projectName = ctx.projectName;
  });

  it('executes a JavaScript file passed as a relative path from the project root', async () => {
    await fileRepository.createFile(
      projectId,
      '/src/relative-node-entry.js',
      "console.log('relative entry ok');",
      'file'
    );

    const shell = await terminalCommandRegistry.getShell(projectName, projectId, {
      fileRepository,
    });
    const result = await shell!.run('node src/relative-node-entry.js');

    expect(result.code).toBe(0);
    expect(result.stderr).not.toContain('Cannot find module');
    expect(result.stdout).toContain('relative entry ok');
  });

  it('sets process.cwd() to the terminal working directory', async () => {
    await fileRepository.createFile(
      projectId,
      '/src/cwd-node-entry.js',
      'console.log(process.cwd());',
      'file'
    );

    const shell = await terminalCommandRegistry.getShell(projectName, projectId, {
      fileRepository,
    });
    await shell!.run('cd src');
    const result = await shell!.run('node cwd-node-entry.js');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`/projects/${projectName}/src`);
  });

  it('exposes runtime process.cwd() through global objects', async () => {
    await fileRepository.createFile(
      projectId,
      '/src/global-cwd-node-entry.js',
      [
        'console.log(global.process.cwd());',
        'console.log(globalThis.process.cwd());',
        "console.log(require('process').cwd());",
      ].join('\n'),
      'file'
    );

    const shell = await terminalCommandRegistry.getShell(projectName, projectId, {
      fileRepository,
    });
    await shell!.run('cd src');
    const result = await shell!.run('node global-cwd-node-entry.js');

    expect(result.code).toBe(0);
    const cwd = `/projects/${projectName}/src`;
    expect(result.stdout.match(new RegExp(cwd, 'g'))).toHaveLength(3);
  });
});
