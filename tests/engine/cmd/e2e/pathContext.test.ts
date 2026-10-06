import { beforeEach, describe, expect, it, vi } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { HOME_DIR } from '@/engine/core/pathUtils';
import { setupTestProject } from '../../../_helpers/testProject';

describe('shell absolute path context', () => {
  beforeEach(async () => {
    vi.unstubAllEnvs();
    await terminalCommandRegistry.clearAll();
  });

  it('allows absolute cwd paths outside the workspace root', async () => {
    const { repo, rootPath } = await setupTestProject('ShellPathContextTest');
    await repo.mkdir('/tmp/outside-workspace', { recursive: true });
    const shell = await terminalCommandRegistry.getShell(rootPath);

    const result = await shell.run('cd /tmp/outside-workspace && pwd');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('/tmp/outside-workspace');
  });

  it('expands quoted HOME paths containing spaces as one path', async () => {
    const { repo, rootPath } = await setupTestProject('ShellHomePathTest');
    const homePath = `${rootPath}/home folder`;
    await repo.mkdir(homePath, { recursive: true });
    const shell = await terminalCommandRegistry.getShell(rootPath, {
      env: { HOME: homePath },
    });

    const result = await shell.run('cd "$HOME" && pwd');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(homePath);
  });

  it('uses the Linux HOME for tilde and argument-free cd outside the workspace', async () => {
    const { repo, rootPath } = await setupTestProject('ShellDefaultHomeTest');
    await repo.mkdir(HOME_DIR, { recursive: true });
    vi.stubEnv('HOME', `${rootPath}/ambient-home`);
    const shell = await terminalCommandRegistry.getShell(rootPath);

    const environment = await shell.run('echo $HOME');
    const tilde = await shell.run('cd ~ && pwd');
    const noArgument = await shell.run('cd && pwd');

    expect(environment.stdout.trim()).toBe(HOME_DIR);
    expect(tilde.code).toBe(0);
    expect(tilde.stdout).toContain(HOME_DIR);
    expect(noArgument.code).toBe(0);
    expect(noArgument.stdout).toContain(HOME_DIR);
  });

  it('leaves quoted tilde literal and expands unquoted tilde from HOME', async () => {
    const { repo, rootPath } = await setupTestProject('ShellTildePathTest');
    const homePath = `${rootPath}/home`;
    await repo.mkdir(homePath, { recursive: true });
    const shell = await terminalCommandRegistry.getShell(rootPath, {
      env: { HOME: homePath },
    });

    const expanded = await shell.run('cd ~ && pwd');
    const quoted = await shell.run("cd '~'");

    expect(expanded.code).toBe(0);
    expect(expanded.stdout).toContain(homePath);
    expect(quoted.code).not.toBe(0);
  });

  it('rejects copying a directory into itself or one of its descendants', async () => {
    const { repo, rootPath } = await setupTestProject('ShellCopyPathTest');
    const sourcePath = `${rootPath}/copy-source`;
    await repo.mkdir(sourcePath, { recursive: true });
    await repo.writeFile(`${sourcePath}/file.txt`, 'content');
    const shell = await terminalCommandRegistry.getShell(rootPath);

    const selfCopy = await shell.run(`cp -r ${sourcePath} ${sourcePath}`);
    const nestedCopy = await shell.run(`cp -r ${sourcePath} ${sourcePath}/nested`);

    expect(selfCopy.code).not.toBe(0);
    expect(nestedCopy.code).not.toBe(0);
    expect(await repo.exists(`${sourcePath}/nested`)).toBe(false);
  });
});
