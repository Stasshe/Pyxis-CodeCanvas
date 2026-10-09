import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { setupTestProject } from '../../../../_helpers/testProject';

describe('printf through the shell', () => {
  let shell: Awaited<ReturnType<typeof terminalCommandRegistry.getShell>>;

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    const { rootPath } = await setupTestProject('PrintfTest');
    shell = await terminalCommandRegistry.getShell(rootPath);
  });

  afterEach(async () => {
    await terminalCommandRegistry.clearAll();
  });

  it('interprets escaped newlines in the format string', async () => {
    const result = await shell.run('printf "line1\\nline2\\nline3"');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('line1\nline2\nline3');
  });

  it('formats string and decimal operands and escaped percent signs', async () => {
    const result = await shell.run("printf '%s %d %%' item 42");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('item 42 %');
  });

  it('repeats the format for remaining operands', async () => {
    const result = await shell.run("printf '%s,' one two three");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('one,two,three,');
  });

  it('does not treat escaped percent signs as operand conversions', async () => {
    const result = await shell.run("printf '%%' unused");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('%');
  });

  it('uses empty strings and zero for missing conversion operands', async () => {
    const result = await shell.run("printf '%s %d'");

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe(' 0');
  });
});
