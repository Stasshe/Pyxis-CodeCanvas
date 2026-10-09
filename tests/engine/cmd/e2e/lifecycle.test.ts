import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UnixCommands } from '@/engine/cmd/global/unix';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(complete => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe('shell execution lifecycle', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;
  let project: Awaited<ReturnType<typeof setupTestProject>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    project = await setupTestProject('LifecycleE2ETest');
    shell = await terminalCommandRegistry.getShell(project.rootPath);
  });

  it('consumes an interactive exit after returning its exit request', async () => {
    const exited = await shell.run('exit 7; printf unreachable');
    expect(exited).toMatchObject({ stdout: '', stderr: '', code: 7, exitShell: true });
    expect(shell.getExecutor().getRequestedExit()).toBeUndefined();
    const next = await shell.run('printf alive');
    expect(next).toMatchObject({ stdout: 'alive', stderr: '', code: 0, exitShell: false });
  });

  it('retains a brace exit until the enclosing command list stops', async () => {
    const exited = await shell.run('{ printf before; exit 9; }; printf unreachable');
    expect(exited).toMatchObject({ stdout: 'before', stderr: '', code: 9, exitShell: true });
    expect(await shell.run('printf alive')).toMatchObject({ stdout: 'alive', code: 0 });
  });

  it('retains script exit across its command lines and keeps the parent shell usable', async () => {
    await project.repo.writeFile(
      `${project.rootPath}/exit.sh`,
      'trap \'printf "exit:%s" "$?"\' EXIT\nprintf before\n{ exit 17; }\nprintf unreachable\n'
    );
    const result = await shell.run('bash exit.sh');
    expect(result).toMatchObject({
      stdout: 'beforeexit:17',
      stderr: '',
      code: 17,
      exitShell: false,
    });
    expect(await shell.run('printf alive')).toMatchObject({ stdout: 'alive', code: 0 });
  });

  it('propagates a function exit and consumes it after the enclosing run', async () => {
    const exited = await shell.run('leave() { exit 4; }; leave; printf unreachable');
    expect(exited).toMatchObject({ stdout: '', stderr: '', code: 4, exitShell: true });
    expect(await shell.run('printf alive')).toMatchObject({ stdout: 'alive', code: 0 });
  });

  it.each([
    ['command substitution', 'printf "%s" "$(sleep 30; printf unreachable)"'],
    [
      'nested command substitution',
      'printf "%s" "$(printf "%s" "$(sleep 30; printf unreachable)")"',
    ],
    ['script assignment', 'bash substitution.sh'],
  ])('interrupts %s and allows the next command', async (_label, command) => {
    await project.repo.writeFile(
      `${project.rootPath}/substitution.sh`,
      'VALUE=$(sleep 30; printf unreachable)\nprintf "%s" "$VALUE"\n'
    );
    const started = deferred();
    const original = UnixCommands.prototype.sleep;
    const spy = vi.spyOn(UnixCommands.prototype, 'sleep').mockImplementation(function (
      this: UnixCommands,
      ...args: Parameters<UnixCommands['sleep']>
    ) {
      const completion = original.apply(this, args);
      started.resolve();
      return completion;
    });
    const completion = shell.run(command);
    try {
      await Promise.race([
        started.promise,
        completion.then(result => {
          throw new Error(`Command completed before sleep started: ${result.stderr}`);
        }),
      ]);
      shell.killForeground('SIGINT');
      const result = await completion;
      expect(result).toMatchObject({ stdout: '', code: 130, interrupted: true });
      expect(result.stderr).toBe('');
      expect(await shell.run('printf alive')).toMatchObject({
        stdout: 'alive',
        stderr: '',
        code: 0,
        interrupted: false,
      });
    } finally {
      shell.killForeground('SIGINT');
      spy.mockRestore();
    }
  });

  it('interrupts a directly requested subshell before its fork is returned', async () => {
    const executor = shell.getExecutor();
    const forked = deferred();
    const release = deferred();
    const original = executor.fork;
    const spy = vi.spyOn(executor, 'fork').mockImplementation(async () => {
      const child = await original.call(executor);
      forked.resolve();
      await release.promise;
      return child;
    });
    const completion = shell.runInSubshell('sleep 30; printf unreachable');
    try {
      await forked.promise;
      shell.killForeground('SIGINT');
      release.resolve();
      const result = await completion;
      expect(result).toMatchObject({ stdout: '', stderr: '', code: 130, interrupted: true });
      expect(await shell.run('printf alive')).toMatchObject({
        stdout: 'alive',
        stderr: '',
        code: 0,
        interrupted: false,
      });
    } finally {
      release.resolve();
      shell.killForeground('SIGINT');
      spy.mockRestore();
    }
  });
});
