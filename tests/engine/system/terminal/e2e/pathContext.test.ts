import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellExecutor } from '@/engine/system/shell/executor';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { HOME_DIR } from '@/engine/core/paths';
import { setupTestProject } from '../../../../_helpers/testProject';

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

  it('isolates command substitution cwd and preserves assignment values', async () => {
    const { repo, rootPath } = await setupTestProject('ShellSubstitutionCwdTest');
    const outsidePath = '/tmp/substitution-cwd';
    await repo.mkdir(outsidePath, { recursive: true });
    const shell = await terminalCommandRegistry.getShell(rootPath);

    const substitution = await shell.run('echo "$(cd /tmp/substitution-cwd && pwd)"');
    const parentCwd = await shell.run('pwd');
    const assignment = await shell.run("VALUE='value with spaces'");
    const value = await shell.run('echo "$VALUE"');
    const commandValue = await shell.run('RESULT="$(cd /tmp/substitution-cwd && pwd)"');
    const commandValueOutput = await shell.run('echo "$RESULT"');
    const literalReplacement = await shell.run('RESULT="$(echo \'$&\')"');
    const literalOutput = await shell.run('echo "$RESULT"');
    const failedSubstitution = await shell.run('RESULT=$(test "")');
    const failureStatus = await shell.run('echo $?');

    expect(substitution.code).toBe(0);
    expect(substitution.stdout).toBe(`${outsidePath}\n`);
    expect(parentCwd.stdout.trim()).toBe(rootPath);
    expect(assignment.code).toBe(0);
    expect(value.stdout).toBe('value with spaces\n');
    expect(commandValue.code).toBe(0);
    expect(commandValueOutput.stdout).toBe(`${outsidePath}\n`);
    expect(literalReplacement.code).toBe(0);
    expect(literalOutput.stdout).toBe('$&\n');
    expect(failedSubstitution.code).toBe(1);
    expect(failureStatus.stdout).toBe('1\n');
  });

  it('keeps script working directory and shell options in the child process', async () => {
    const { repo, rootPath } = await setupTestProject('ShellScriptIsolationTest');
    await repo.mkdir('/tmp/script-cwd', { recursive: true });
    await repo.writeFile(`${rootPath}/isolation.sh`, 'cd /tmp/script-cwd\nset -u\n');
    const shell = await terminalCommandRegistry.getShell(rootPath);

    const script = await shell.run('bash isolation.sh');
    const parentCwd = await shell.run('pwd');
    const parentExpansion = await shell.run('echo "$MISSING"');

    expect(script.code).toBe(0);
    expect(parentCwd.stdout.trim()).toBe(rootPath);
    expect(parentExpansion.code).toBe(0);
  });

  it('releases abort listeners for completed command substitution shells', async () => {
    const { repo, rootPath } = await setupTestProject('ShellAbortListenerTest');
    const controller = new AbortController();
    const addListener = vi.spyOn(controller.signal, 'addEventListener');
    const removeListener = vi.spyOn(controller.signal, 'removeEventListener');
    const executor = new ShellExecutor({
      rootPath,
      unix: terminalCommandRegistry.getUnixCommands(rootPath),
      fsClient: repo,
      signal: controller.signal,
    });

    const result = await executor.run('echo "$(pwd)"');

    expect(result.code).toBe(0);
    expect(addListener).toHaveBeenCalledTimes(2);
    expect(removeListener).toHaveBeenCalledTimes(1);
    executor.dispose();
    expect(removeListener).toHaveBeenCalledTimes(2);
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
