import { afterEach, describe, expect, it, vi } from 'vitest';
import { FsCore } from '@/engine/core/fs/core';
import { UnixCommands } from '@/engine/system/commands/unix';
import {
  type AppCommandHandlers,
  configureAppCommandHandlers,
} from '@/engine/system/shell/commandDispatch';
import { StreamShell } from '@/engine/system/shell/streamShell';
import { directoryTree } from '../../../_helpers/opfs';

let shell: StreamShell | undefined;

afterEach(async () => {
  configureAppCommandHandlers(undefined);
  await shell?.dispose();
  shell = undefined;
});

async function createShell(handlers: AppCommandHandlers): Promise<StreamShell> {
  const core = new FsCore();
  await core.init(directoryTree());
  const rootPath = '/home/pyxis/workspace';
  await core.mkdir(rootPath, { recursive: true });
  configureAppCommandHandlers(handlers);
  shell = new StreamShell({ rootPath, unix: new UnixCommands(rootPath, core), fsClient: core });
  return shell;
}

describe('Application command injection', () => {
  it('preserves pyxis argument parsing and missing-action errors', async () => {
    const pyxis = vi.fn<AppCommandHandlers['pyxis']>().mockResolvedValue(undefined);
    const current = await createShell({ pyxis, dev: vi.fn() });
    const result = await current.run('pyxis cache clear modules; pyxis init --all');
    expect(result.code).toBe(0);
    expect(pyxis.mock.calls.map(call => call.slice(0, 3))).toEqual([
      ['cache-clear', ['modules'], '/home/pyxis/workspace'],
      ['init', ['--all'], '/home/pyxis/workspace'],
    ]);
    const invalid = await current.run('pyxis cache');
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toBe('pyxis: missing action. Usage: pyxis <category> <action> [args]\n');
    expect(pyxis).toHaveBeenCalledTimes(2);
  });

  it('preserves dev output and reports injected handler failures', async () => {
    const current = await createShell({
      pyxis: vi.fn(),
      async dev(args, _rootPath, writeOutput) {
        if (args[0] === 'fail') throw new Error('failed scenario');
        await writeOutput(args.join(' '));
      },
    });
    const result = await current.run('dev help');
    expect(result.stdout).toBe('help\n');
    expect(result.code).toBe(0);
    const failed = await current.run('dev fail');
    expect(failed.stderr).toBe('dev: failed scenario\n');
    expect(failed.code).toBe(1);
  });
});
