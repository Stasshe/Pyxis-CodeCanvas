import Shell from '@/engine/cmd/shell/shell';

describe('Shell basic pipeline and sh execution', () => {
  test('echo with pipe to grep filters lines', async () => {
    const mockUnix: any = {
      echo: async (text: string) => text,
      cat: async (path: string) => `file:${path}`,
      pwd: async () => '/projects/default',
    };

    const shell = new Shell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run(`echo 'a\nb' | grep a`);
    expect(res.stdout).toBe('a');
    expect(res.code).toBe(0);
  });

  test('echo piped to cat passes through stdin', async () => {
    const mockUnix: any = {
      echo: async (text: string) => text,
      cat: async (path: string) => `file:${path}`,
      pwd: async () => '/projects/default',
    };
    const shell = new Shell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run(`echo hello | cat`);
    expect(res.stdout).toBe('hello');
    expect(res.code).toBe(0);
  });

  test('sh executes lines from file sequentially', async () => {
    const mockUnix: any = {
      echo: async (text: string) => text + '\n',
      cat: async (path: string) => `echo one\necho two\n`,
      pwd: async () => '/projects/default',
    };
    const shell = new Shell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh script.sh');
    // echo returns with trailing newlines in this mock; run concatenates stdout
    expect(res.stdout).toContain('one');
    expect(res.stdout).toContain('two');
    expect(res.code).toBe(0);
  });
});
