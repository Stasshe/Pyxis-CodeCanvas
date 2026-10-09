import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('shell groups and command lists', () => {
  let shell: NonNullable<Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const project = await setupTestProject('GroupsE2ETest');
    const created = await terminalCommandRegistry.getShell(project.rootPath);
    if (!created) throw new Error('Shell initialization failed');
    shell = created;
  });

  it('expands each list command after preceding assignments', async () => {
    const result = await shell.run('VALUE=before; VALUE=after; printf "%s" "$VALUE"');
    expect(result).toMatchObject({ stdout: 'after', stderr: '', code: 0 });
  });

  it('keeps expanded operators and quotes as argument data', async () => {
    shell.setEnv('TEXT', 'first; echo injected | cat "quoted"');
    const result = await shell.run('printf "%s" "$TEXT"');
    expect(result).toMatchObject({
      stdout: 'first; echo injected | cat "quoted"',
      stderr: '',
      code: 0,
    });
  });

  it('shares brace state and isolates subshell state', async () => {
    const result = await shell.run(
      'VALUE=parent; (VALUE=child; printf "%s\\n" "$VALUE"); { VALUE=shared; }; printf "%s" "$VALUE"'
    );
    expect(result).toMatchObject({ stdout: 'child\nshared', stderr: '', code: 0 });
    expect(shell.getEnv('VALUE')).toBe('shared');
  });

  it('isolates assignments made by pipeline stages', async () => {
    const result = await shell.run(
      'VALUE=parent; { VALUE=child; printf "%s" "$VALUE"; } | cat; printf "%s" "$VALUE"'
    );
    expect(result).toMatchObject({ stdout: 'childparent', stderr: '', code: 0 });
    expect(shell.getEnv('VALUE')).toBe('parent');
  });

  it('evaluates logical lists from left to right', async () => {
    const result = await shell.run(
      'false && printf bad || printf first; true || false && printf second'
    );
    expect(result).toMatchObject({ stdout: 'firstsecond', stderr: '', code: 0 });
  });

  it('applies inherited errexit to groups and suppresses it in tested groups', async () => {
    const result = await shell.run(
      '(set -e; false; printf bad); (set -e; false; printf ok) || printf bad'
    );
    expect(result).toMatchObject({ stdout: 'ok', stderr: '', code: 0 });
  });

  it('propagates brace exit and contains subshell exit', async () => {
    const contained = await shell.run('(exit 42); printf "%s" "$?"');
    expect(contained).toMatchObject({ stdout: '42', stderr: '', code: 0 });
    const shared = await shell.run('{ exit 7; }; printf bad');
    expect(shared).toMatchObject({ stdout: '', stderr: '', code: 7, exitShell: true });
  });

  it('waits for background groups while preserving parent state', async () => {
    const output: string[] = [];
    const result = await shell.run(
      'VALUE=parent; (sleep 0.01; VALUE=child; printf background) & printf foreground; wait; printf "%s" "$VALUE"',
      { stdout: text => output.push(text) }
    );
    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    expect(output.join('')).toBe('foregroundbackgroundparent');
    expect(shell.getEnv('VALUE')).toBe('parent');
  });
});
