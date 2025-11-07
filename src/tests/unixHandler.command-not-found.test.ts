import StreamShell from '../engine/cmd/shell/streamShell';

// Minimal unix mock that simulates absence of commands
const makeUnixMock = () => ({
  cat: async (path: string) => null,
  help: async (arg?: string) => 'available commands: ls, cat, echo',
  // other helpers used by unixHandler may be called but not needed for this test
  ls: async () => '',
});

describe('StreamShell / unixHandler integration', () => {
  test('nonexistent command yields exit 127 and command not found message', async () => {
    const shell = new StreamShell({
      projectName: 'p',
      projectId: 'p',
      unix: makeUnixMock() as any,
    });

    const res = await shell.run('this-command-does-not-exist');

    expect(res.code).toBe(127);
    expect(
      res.stderr.includes('Command not found') || res.stdout.includes('Command not found')
    ).toBe(true);
  });
});
