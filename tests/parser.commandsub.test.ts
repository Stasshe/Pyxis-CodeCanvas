import StreamShell from '@/engine/cmd/shell/streamShell';

describe('StreamShell command-substitution and variable expansion', () => {
  test('echo with $(...) substitution', async () => {
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => `file:${path}`,
      pwd: async () => '/projects/default',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };

    const shell = new StreamShell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
  const res = await shell.run('echo $(echo a)');
  // debug
  // console.log('RES1', res);
  expect(res.stdout.trim()).toBe('a');
    expect(res.code).toBe(0);
  });

  test('backtick substitution', async () => {
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => `file:${path}`,
      pwd: async () => '/projects/default',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };
    const shell = new StreamShell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
  const res = await shell.run('echo `echo hi`');
  // console.log('RES2', res);
  expect(res.stdout.trim()).toBe('hi');
  });

  test('nested substitution', async () => {
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => `file:${path}`,
      pwd: async () => '/projects/default',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };
    const shell = new StreamShell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
  const res = await shell.run('echo $(echo $(echo nested))');
  // console.log('RES3', res);
  expect(res.stdout.trim()).toBe('nested');
  });

  test('variable expansion via parser env', async () => {
    // Set env var for process so parser will expand
    process.env.TESTVAR_FOR_SHELL = 'v1';
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => `file:${path}`,
      pwd: async () => '/projects/default',
      ls: async () => '',
      head: async () => '',
      tail: async () => '',
      grep: async () => '',
    };
    const shell = new StreamShell({ projectName: 'default', projectId: 'p1', unix: mockUnix });
  const res = await shell.run('echo $TESTVAR_FOR_SHELL');
  // console.log('RES4', res);
  expect(res.stdout.trim()).toBe('v1');
  });
});
