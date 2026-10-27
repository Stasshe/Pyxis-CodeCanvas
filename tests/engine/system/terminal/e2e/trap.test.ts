import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { setupTestProject } from '../../../../_helpers/testProject';

describe('shell trap registrations', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('TrapTest');
    rootPath = project.rootPath;
    repo = project.repo;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('runs ERR and EXIT traps with the triggering status', async () => {
    await repo.writeFile(
      `${rootPath}/status.sh`,
      "trap 'echo err:$?' ERR\nfalse\ntrap -- 'echo exit:$?' EXIT\nexit 7\n"
    );

    const result = await shell!.run('bash status.sh');

    expect(result.code, result.stderr).toBe(7);
    expect(result.stdout).toBe('err:1\nexit:7\n');
  });

  it('runs an interactive EXIT trap with the exit status', async () => {
    await shell!.run("trap 'echo exit:$?' EXIT");
    const ordinaryCommand = await shell!.run('true');

    expect(ordinaryCommand.stdout).toBe('');
    expect(ordinaryCommand.code).toBe(0);

    const result = await shell!.run('exit 7');

    expect(result.code, result.stderr).toBe(7);
    expect(result.stdout).toBe('exit:7\n');
  });

  it('runs a script EXIT trap only at shell exit and preserves its status', async () => {
    await repo.writeFile(
      `${rootPath}/boundaries.sh`,
      "trap 'echo exit:$?' EXIT\nf() { echo function; }\nf\nif false; then echo unwanted; fi\n( echo subshell )\necho main\nexit 4\n"
    );

    const result = await shell!.run('bash boundaries.sh');

    expect(result.code, result.stderr).toBe(4);
    expect(result.stdout).toBe('function\nsubshell\nmain\nexit:4\n');
  });

  it('allows an interactive EXIT trap to override the exit status', async () => {
    await shell!.run("trap 'exit 9' EXIT");

    const result = await shell!.run('exit 7');

    expect(result.code, result.stderr).toBe(9);
  });

  it('accepts -- and removes an EXIT trap', async () => {
    await repo.writeFile(
      `${rootPath}/remove.sh`,
      "trap -- 'echo unreachable' EXIT\ntrap - EXIT\nexit 3\n"
    );

    const result = await shell!.run('bash remove.sh');

    expect(result.code, result.stderr).toBe(3);
    expect(result.stdout).toBe('');
  });

  it('normalizes numeric zero spellings', async () => {
    await repo.writeFile(`${rootPath}/aliases.sh`, "trap 'echo unreachable' 0\ntrap - 00\n");

    const result = await shell!.run('bash aliases.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
  });

  it.each(['INT', 'TERM', 'HUP', 'DEBUG', 'RETURN', 'SIGERR', 'SIGEXIT', '2', '15', '999', 'KILL'])(
    'rejects unsupported signal %s without partially registering traps',
    async signal => {
      await repo.writeFile(`${rootPath}/unsupported.sh`, `trap 'echo err' ERR ${signal}\nfalse\n`);

      const result = await shell!.run('bash unsupported.sh');

      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`trap: unsupported signal specification: ${signal}`);
      expect(result.stdout).toBe('');
    }
  );

  it('returns an error for a direct unsupported trap registration', async () => {
    const result = await shell!.run("trap ':' INT");

    expect(result.code).toBe(1);
    expect(result.stderr).toContain('trap: unsupported signal specification: INT');
  });

  it('stops after a failed command with errexit enabled', async () => {
    await repo.writeFile(
      `${rootPath}/errexit.sh`,
      "set -e\ntrap 'echo caught:$?' ERR\nfalse\necho unreachable\n"
    );

    const result = await shell!.run('bash errexit.sh');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('caught:1\n');
  });

  it('runs EXIT with the status chosen by exit inside an ERR trap', async () => {
    await repo.writeFile(
      `${rootPath}/err-exit.sh`,
      "set -e\ntrap 'echo exit:$?' EXIT\ntrap 'exit 7' ERR\nfalse\necho unreachable\n"
    );

    const result = await shell!.run('bash err-exit.sh');

    expect(result.code, result.stderr).toBe(7);
    expect(result.stdout).toBe('exit:7\n');
  });

  it('uses the current status after an ERR trap removes itself', async () => {
    await repo.writeFile(
      `${rootPath}/err-remove.sh`,
      "trap 'trap - ERR; echo caught:$?' ERR\nfalse\nfalse\necho end\n"
    );

    const result = await shell!.run('bash err-remove.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('caught:0\nend\n');
  });

  it('does not run a replacement EXIT trap during the same exit', async () => {
    await repo.writeFile(
      `${rootPath}/exit-reregister.sh`,
      'trap \'trap "echo second" EXIT; echo first\' EXIT\nexit 3\n'
    );

    const result = await shell!.run('bash exit-reregister.sh');

    expect(result.code, result.stderr).toBe(3);
    expect(result.stdout).toBe('first\n');
  });
});
