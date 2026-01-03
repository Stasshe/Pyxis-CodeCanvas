// Tests for inline/semicolon-style script control flow in StreamShell
describe('StreamShell inline/semicolon control flow', () => {
  test('inline if; then; fi works', async () => {
    const StreamShellClass = require('@/engine/cmd/shell/streamShell').default;
    const scripts: Record<string, string> = {
      'inline1.sh': `if echo true; then echo ok; else echo nok; fi\n`,
    };
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };
  const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh inline1.sh');
    expect(res.code).toBe(0);
    expect(String(res.stdout || '')).toContain('ok');
  });

  test('for loop inline semicolons works', async () => {
    const StreamShellClass = require('@/engine/cmd/shell/streamShell').default;
    const scripts: Record<string, string> = {
      'inline2.sh': `for x in a b; do echo $x; done\n`,
    };
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };
  const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh inline2.sh');
    // POSIX echo adds newlines
    expect(String(res.stdout || '').trim()).toBe('a\nb');
  });

  test('mixed newline and semicolon forms', async () => {
    const StreamShellClass = require('@/engine/cmd/shell/streamShell').default;
    const scripts: Record<string, string> = {
      'inline3.sh': `if echo true; then\n  echo yes\nfi\n`,
    };
    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };
    const shell = new StreamShellClass({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh inline3.sh');
    expect(String(res.stdout || '')).toContain('yes');
  });
});
