// Tests for positional arguments ($0, $1.., $@) in script execution
jest.mock('@isomorphic-git/lightning-fs', () => ({
  __esModule: true,
  default: class MockLightningFS {
    constructor() {}
    async init() {}
    async mkdir() {}
    async rmdir() {}
  },
}));

const StreamShellArgs = require('@/engine/cmd/shell/streamShell').default;

describe('StreamShell script positional args', () => {
  test('$0, $1 and $@ expansion', async () => {
    const scripts: Record<string, string> = {
      'args.sh': `echo $0
echo $1
echo $@
`,
    };

    const mockUnix: any = {
      echo: async (t: string) => t,
      cat: async (path: string) => scripts[path] ?? scripts[path.replace(/^\//, '')] ?? null,
      pwd: async () => '/projects/default',
    };

  const shell = new StreamShellArgs({ projectName: 'default', projectId: 'p1', unix: mockUnix });
    const res = await shell.run('sh args.sh one two three');
    const out = String(res.stdout || '');
    // echo in our builtins writes raw tokens without newline, so we expect concatenated tokens
    // We call echo three times; each returns its argument as-is.
    expect(out).toContain('args.sh');
    expect(out).toContain('one');
    expect(out).toContain('two three');
  });
});
