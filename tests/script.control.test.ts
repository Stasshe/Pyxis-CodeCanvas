// Tests for simple script control flow support in StreamShell
jest.mock('@isomorphic-git/lightning-fs', () => ({
  __esModule: true,
  default: class MockLightningFS {
    constructor() {}
    async init() {}
    async mkdir() {}
    async rmdir() {}
  },
}));

const StreamShellClass = require('@/engine/cmd/shell/streamShell').default;

describe('StreamShell script control flow', () => {
  test('if then else executes then branch when condition succeeds', async () => {
    const scripts: Record<string, string> = {
      'script1.sh': `if echo true
then
  echo ok
else
  echo nok
fi
`,
    };

    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };

    const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh script1.sh');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('ok');
  });

  test('if else executes else branch when condition fails', async () => {
    const scripts: Record<string, string> = {
      'script2.sh': `if falsecmd
then
  echo a
else
  echo b
fi
`,
    };

    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };
    const commandRegistry: any = {
      hasCommand: (n: string) => n === 'falsecmd',
      executeCommand: async (name: string) => {
        throw new Error('forced-failure');
      },
    };

    const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix, commandRegistry });
    const res = await shell.run('sh script2.sh');
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('b');
  });

  test('elif chain chooses the first true branch', async () => {
    const scripts: Record<string, string> = {
      'script3.sh': `if falsecmd
then
  echo a
elif echo yes
then
  echo b
else
  echo c
fi
`,
    };

    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };
    const commandRegistry: any = {
      hasCommand: (n: string) => n === 'falsecmd',
      executeCommand: async (name: string) => {
        throw new Error('forced-failure');
      },
    };

    const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix, commandRegistry });
    const res = await shell.run('sh script3.sh');
    expect(res.stdout).toContain('b');
  });

  test('for loop iterates over items and expands loop var', async () => {
    const scripts: Record<string, string> = {
      'script4.sh': `for x in a b c
do
  echo $x
done
`,
    };

    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };

  const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix });
  const res = await shell.run('sh script4.sh');
  // POSIX echo adds newlines - expect each item on separate line
  expect(String(res.stdout || '').trim()).toBe('a\nb\nc');
  });

  test('while loop runs body and respects break', async () => {
    const scripts: Record<string, string> = {
      'script5.sh': `while echo 1
do
  echo loop
  break
done
`,
    };

    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };

    const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh script5.sh');
    expect(String(res.stdout || '').trim()).toContain('loop');
  });
});
