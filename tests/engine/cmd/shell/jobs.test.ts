import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('shell job identities', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('ShellJobIdentityTest');
    shell = await terminalCommandRegistry.getShell(project.rootPath);
  });

  it('uses a pipeline process PID for $! and wait', async () => {
    const result = await shell!.run('true | true & printf "%s\\n" "$!"; wait "$!"');
    const pid = Number(result.stdout.trim());

    expect(pid).toBeGreaterThan(1);
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('waits for a background command by its saved $! PID', async () => {
    const result = await shell!.run(
      'false & pid=$!; printf "pid:%s\\n" "$pid"; wait "$pid"; printf "wait:%s\\n" "$?"'
    );
    const lines = result.stdout.trim().split('\n');
    const pid = Number(lines[0]?.replace('pid:', ''));

    expect(pid).toBeGreaterThan(1);
    expect(lines[1]).toBe('wait:1');
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
  });

  it('keeps displayed job selectors separate from process PIDs', async () => {
    const result = await shell!.run('false & wait %1');

    expect(result.stderr).toBe('');
    expect(result.code).toBe(1);
  });
});
