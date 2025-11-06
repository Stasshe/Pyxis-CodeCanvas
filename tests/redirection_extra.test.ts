import parseCommandLine from '@/engine/cmd/shell/parser';
import StreamShell from '@/engine/cmd/shell/streamShell';

describe('Redirection extra tests', () => {
  let projectId: string;
  let projectName: string;
  let mockUnix: any;
  let mockFileRepo: any;

  beforeEach(async () => {
    projectId = `test-project-${Date.now()}`;
    projectName = 'test-project';

    const memoryFiles = new Map<string, { path: string; content: string; type: string }>();

    mockFileRepo = {
      getProjectFiles: jest.fn(async (pid: string) => Array.from(memoryFiles.values()).filter(f => f.path.startsWith('/'))),
      createFile: jest.fn(async (pid: string, path: string, content: string, type: string) => {
        memoryFiles.set(path.startsWith('/') ? path : `/${path}`, { path: path.startsWith('/') ? path : `/${path}`, content, type });
        return { id: `file-${Date.now()}`, path, content, type };
      }),
      saveFile: jest.fn(async (file: any) => {
        memoryFiles.set(file.path, file);
        return file;
      }),
    };

    mockUnix = {
      pwd: jest.fn(async () => '/'),
      cd: jest.fn(async (p: string) => ''),
      cat: jest.fn(async (path: string) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const f = memoryFiles.get(normalized);
        if (!f) throw new Error(`cat: ${path}: No such file or directory`);
        return f.content;
      }),
      echo: jest.fn(async (text: string) => text + '\n'),
      ls: jest.fn(async () => ''),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('&>> appends both stdout and stderr to file', async () => {
    // pre-create file with prefix
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    await mockFileRepo.createFile(projectId, '/both.txt', 'PRE\n', 'file');
    const script = `#!/bin/sh
nonexistent_cmd &>> /both.txt
`;
    await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
    const res = await shell.run('sh /test.sh');
    const files = await mockFileRepo.getProjectFiles(projectId);
    const both = files.find((f: any) => f.path === '/both.txt');
    expect(both).toBeDefined();
    expect(both.content.startsWith('PRE\n')).toBeTruthy();
    expect(both.content).toContain('Command not found');
    expect(res.stdout).toBe('');
    expect(res.stderr).toBe('');
  });

  test('parser records fd duplication for 3>&1 and 4>&2', () => {
    const segs1 = parseCommandLine('cmd 3>&1');
    expect(segs1.length).toBeGreaterThan(0);
    const s1 = segs1[0] as any;
    expect(s1.fdDup).toBeDefined();
    expect(s1.fdDup.some((m: any) => m.from === 3 && m.to === 1)).toBeTruthy();

    const segs2 = parseCommandLine('cmd 4>&2');
    expect(segs2.length).toBeGreaterThan(0);
    const s2 = segs2[0] as any;
    expect(s2.fdDup).toBeDefined();
    expect(s2.fdDup.some((m: any) => m.from === 4 && m.to === 2)).toBeTruthy();
  });
});
