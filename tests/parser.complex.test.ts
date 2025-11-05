import StreamShell from '@/engine/cmd/shell/streamShell';

describe('Complex parser/executor behaviors (IFS/quoting/command-subst)', () => {
  test('unquoted command-substitution -> word-splitting into separate args', async () => {
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (p: string) => `file:${p}`,
      pwd: async () => '/p',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };

    const commandRegistry: any = {
      hasCommand: (n: string) => n === 'reportArgs',
      executeCommand: async (name: string, args: string[], ctx: any) => {
        if (name !== 'reportArgs') throw new Error('unknown');
        ctx.stdout.write(JSON.stringify(args));
        ctx.stdout.end();
      },
    };

    const shell = new StreamShell({ projectName: 'p', projectId: 'p1', unix: mockUnix, commandRegistry });
    const res = await shell.run('reportArgs $(echo "a b")');
    expect(res.stdout.trim()).toBe(JSON.stringify(['a', 'b']));
  });

  test('quoted command-substitution should preserve whitespace as single arg (POSIX) — currently NOT supported', async () => {
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (p: string) => `file:${p}`,
      pwd: async () => '/p',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };

    const commandRegistry: any = {
      hasCommand: (n: string) => n === 'reportArgs',
      executeCommand: async (name: string, args: string[], ctx: any) => {
        ctx.stdout.write(JSON.stringify(args));
        ctx.stdout.end();
      },
    };

    const shell = new StreamShell({ projectName: 'p', projectId: 'p1', unix: mockUnix, commandRegistry });
    const res = await shell.run('reportArgs "$(echo a b)"');
  // POSIX expectation would be ["a b"]; current implementation preserves quoted substitution as single arg
  expect(res.stdout.trim()).toBe(JSON.stringify(['a b']));
  });

  test('nested substitutions and quoting interactions', async () => {
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (p: string) => `file:${p}`,
      pwd: async () => '/p',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };

    const commandRegistry: any = {
      hasCommand: (n: string) => n === 'reportArgs',
      executeCommand: async (name: string, args: string[], ctx: any) => {
        ctx.stdout.write(JSON.stringify(args));
        ctx.stdout.end();
      },
    };

    const shell = new StreamShell({ projectName: 'p', projectId: 'p1', unix: mockUnix, commandRegistry });
    const res = await shell.run('reportArgs $(echo $(echo nested))');
    expect(res.stdout.trim()).toBe(JSON.stringify(['nested']));
  });
});
