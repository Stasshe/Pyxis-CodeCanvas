import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('shell script status and options', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('ScriptRunnerTest');
    rootPath = project.rootPath;
    repo = project.repo;
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('returns the last command status when errexit is disabled', async () => {
    await repo.writeFile(`${rootPath}/status.sh`, 'true\ntest ""\n');

    const result = await shell!.run('bash status.sh');

    expect(result.code).toBe(1);
  });

  it('keeps errexit inactive for conditions and handled failures', async () => {
    await repo.writeFile(
      `${rootPath}/control.sh`,
      `set -e
if test ""; then
  echo "wrong branch"
else
  echo "condition handled"
fi
test "" || echo "failure handled"
echo "continued"
`
    );

    const result = await shell!.run('bash control.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('condition handled\nfailure handled\ncontinued\n');
  });

  it('ignores a failed command guarded by a non-final AND list', async () => {
    await repo.writeFile(
      `${rootPath}/and-guard.sh`,
      'set -e\ntest "" && echo skipped\necho continued\n'
    );

    const result = await shell!.run('bash and-guard.sh');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('continued\n');
  });

  it('stops for a failure in the final command of an AND list', async () => {
    await repo.writeFile(`${rootPath}/and-final.sh`, 'set -e\ntrue && test ""\necho unreachable\n');

    const result = await shell!.run('bash and-final.sh');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
  });

  it('uses nounset with default parameter expansion and returns failure status', async () => {
    await repo.writeFile(
      `${rootPath}/nounset.sh`,
      `set -u
echo "\${UNDEFINED_VALUE:-fallback}"
echo "$UNDEFINED_VALUE"
echo "unreachable"
`
    );

    const result = await shell!.run('bash nounset.sh');

    expect(result.code).toBe(2);
    expect(result.stdout).toBe('fallback\n');
    expect(result.stderr).toContain('UNDEFINED_VALUE: unbound variable');
  });

  it('continues after an ordinary status 2 command with nounset enabled', async () => {
    await repo.writeFile(`${rootPath}/nounset-status.sh`, 'set -u\nsh\necho continued\n');

    const result = await shell!.run('bash nounset-status.sh');

    expect(result.code).toBe(0);
    expect(result.stdout).toBe('continued\n');
    expect(result.stderr).toContain('Usage: sh <file>');
  });

  it('applies pipefail when requested by the script', async () => {
    await repo.writeFile(`${rootPath}/pipefail.sh`, 'set -o pipefail\ntest "" | true\n');

    const result = await shell!.run('bash pipefail.sh');

    expect(result.code).toBe(1);
  });
});
