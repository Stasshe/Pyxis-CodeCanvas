import { beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('Unix basics through the shell', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const { rootPath } = await setupTestProject('UnixBasicsTest');
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  it('prints unknown dash-prefixed echo text as an operand', async () => {
    const result = await shell.run('echo "---"');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('---\n');
  });

  it('prints parent directories for multiple paths', async () => {
    const result = await shell.run('dirname /home/pyxis/src/run-test.sh relative/file.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('/home/pyxis/src\nrelative\n');
  });
});
