import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NpmCommands } from '@/engine/cmd/global/npm';
import { handleNPMCommand } from '@/engine/cmd/handlers/npmHandler';
import type { OutputCallbacks } from '@/engine/cmd/shell/types';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';

describe('handleNPMCommand', () => {
  afterEach(() => vi.restoreAllMocks());

  it.each([
    ['pkg@1.2.3', 'pkg'],
    ['@scope/pkg@^2.0.0', '@scope/pkg'],
  ])('passes package spec %s to install', async (spec, expectedName) => {
    const install = vi.fn(async () => 'installed');
    mockNpm({ install });
    const output: string[] = [];
    const errors: string[] = [];

    const code = await handleNPMCommand(
      ['install', spec, '-D'],
      '/workspace',
      async value => {
        output.push(value);
      },
      async value => {
        errors.push(value);
      }
    );

    expect(code).toBe(0);
    expect(install).toHaveBeenCalledWith(expectedName, [
      '-D',
      `--version=${spec.slice(spec.lastIndexOf('@') + 1)}`,
    ]);
    expect(output).toEqual(['installed']);
    expect(errors).toEqual([]);
  });

  it('preserves the npm alias spec while parsing an install request', async () => {
    const install = vi.fn(async () => 'installed');
    mockNpm({ install });

    const code = await handleNPMCommand(
      ['install', 'local-name@npm:@scope/real-name@^2.0.0'],
      '/workspace',
      async () => {},
      async () => {}
    );

    expect(code).toBe(0);
    expect(install).toHaveBeenCalledWith('local-name', ['--version=npm:@scope/real-name@^2.0.0']);
  });

  it('passes every install target to one graph resolution', async () => {
    const installPackages = vi.fn(async () => 'installed');
    mockNpm({ installPackages });

    const code = await handleNPMCommand(
      ['i', 'react@18', 'react-dom@18', '-D'],
      '/workspace',
      async () => {},
      async () => {}
    );

    expect(code).toBe(0);
    expect(installPackages).toHaveBeenCalledWith(
      [
        { name: 'react', version: '18' },
        { name: 'react-dom', version: '18' },
      ],
      ['-D']
    );
  });

  it('rejects unsupported install options without installing', async () => {
    const install = vi.fn(async () => 'installed');
    mockNpm({ install });
    const errors: string[] = [];

    const code = await handleNPMCommand(
      ['install', 'pkg', '--force'],
      '/workspace',
      async () => {},
      async value => {
        errors.push(value);
      }
    );

    expect(code).toBe(1);
    expect(install).not.toHaveBeenCalled();
    expect(errors).toEqual(["npm install: unsupported option '--force'"]);
  });

  it('uninstalls every positional package target', async () => {
    const uninstall = vi.fn(async (packageName: string) => `removed ${packageName}`);
    mockNpm({ uninstall });
    const output: string[] = [];

    const code = await handleNPMCommand(
      ['uninstall', 'react', 'react-dom'],
      '/workspace',
      async value => {
        output.push(value);
      },
      async () => {}
    );

    expect(code).toBe(0);
    expect(uninstall).toHaveBeenNthCalledWith(1, 'react');
    expect(uninstall).toHaveBeenNthCalledWith(2, 'react-dom');
    expect(output).toEqual(['removed react', 'removed react-dom']);
  });

  it('rejects unsupported uninstall options without removing a package', async () => {
    const uninstall = vi.fn(async () => 'removed');
    mockNpm({ uninstall });
    const errors: string[] = [];

    const code = await handleNPMCommand(
      ['uninstall', 'react', '--force'],
      '/workspace',
      async () => {},
      async value => {
        errors.push(value);
      }
    );

    expect(code).toBe(1);
    expect(uninstall).not.toHaveBeenCalled();
    expect(errors).toEqual(["npm uninstall: unsupported option '--force'"]);
  });

  it('returns npm run status and preserves stdout and stderr', async () => {
    const runWithStatus = vi.fn(
      async (_name: string, _args: string[], callbacks: OutputCallbacks) => {
        callbacks.stdout?.('build output');
        callbacks.stderr?.('build error');
        return { stdout: 'build output', stderr: 'build error', code: 23 };
      }
    );
    mockNpm({ runWithStatus });
    const output: string[] = [];
    const errors: string[] = [];

    const code = await handleNPMCommand(
      ['run', 'build'],
      '/workspace',
      async value => {
        output.push(value);
      },
      async value => {
        errors.push(value);
      }
    );

    expect(code).toBe(23);
    expect(runWithStatus).toHaveBeenCalledWith('build', [], expect.any(Object), undefined);
    expect(output).toEqual(['build output']);
    expect(errors).toEqual(['build error']);
  });

  it('forwards script arguments after -- and allows script flags', async () => {
    const runWithStatus = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    mockNpm({ runWithStatus });

    const code = await handleNPMCommand(
      ['run', 'test', '--', '-g', 'two words'],
      '/workspace',
      async () => {},
      async () => {}
    );

    expect(code).toBe(0);
    expect(runWithStatus).toHaveBeenCalledWith(
      'test',
      ['-g', 'two words'],
      expect.any(Object),
      undefined
    );
  });

  it.each(['start', 'test'])('supports npm %s as a script shortcut', async scriptName => {
    const runWithStatus = vi.fn(async () => ({ stdout: '', stderr: '', code: 0 }));
    mockNpm({ runWithStatus });

    const code = await handleNPMCommand(
      [scriptName],
      '/workspace',
      async () => {},
      async () => {}
    );

    expect(code).toBe(0);
    expect(runWithStatus).toHaveBeenCalledWith(scriptName, [], expect.any(Object), undefined);
  });

  it.each([
    ['install', '-g'],
    ['install', 'pkg', '--global'],
    ['list', '-g'],
    ['uninstall', 'pkg', '--global'],
  ])('rejects global operations (%s %s)', async (...args) => {
    const install = vi.fn(async () => 'installed');
    mockNpm({ install });
    const errors: string[] = [];

    const code = await handleNPMCommand(
      args,
      '/workspace',
      async () => {},
      async value => {
        errors.push(value);
      }
    );

    expect(code).toBe(1);
    expect(install).not.toHaveBeenCalled();
    expect(errors).toEqual(['npm: global operations are not supported']);
  });

  it('writes unsupported commands to stderr and returns failure', async () => {
    mockNpm({});
    const output: string[] = [];
    const errors: string[] = [];

    const code = await handleNPMCommand(
      ['publish'],
      '/workspace',
      async value => {
        output.push(value);
      },
      async value => {
        errors.push(value);
      }
    );

    expect(code).toBe(1);
    expect(output).toEqual([]);
    expect(errors).toEqual(["npm: 'publish' is not a supported npm command"]);
  });
});

function mockNpm(methods: Partial<NpmCommands>): void {
  vi.spyOn(terminalCommandRegistry, 'getNpmCommands').mockResolvedValue(methods as NpmCommands);
}
