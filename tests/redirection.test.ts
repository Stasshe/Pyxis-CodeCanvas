import StreamShell from '@/engine/cmd/shell/streamShell';
import { resetGlobalRegistry } from '@/engine/cmd/shell/providers';

describe('Redirection tests', () => {
  let projectId: string;
  let projectName: string;
  let mockUnix: any;
  let mockFileRepo: any;

  beforeEach(async () => {
    // Reset the global provider registry before each test
    await resetGlobalRegistry();
    
    projectId = `test-project-${Date.now()}`;
    projectName = 'test-project';

    const memoryFiles = new Map<string, { path: string; content: string; type: string }>();

    mockFileRepo = {
        getProjectFiles: jest.fn(async (pid: string) => Array.from(memoryFiles.values()).filter(f => f.path.startsWith('/'))),
      getFileByPath: jest.fn(async (pid: string, path: string) => memoryFiles.get(path) || null),
      createFile: jest.fn(async (pid: string, path: string, content: string, type: string) => {
        memoryFiles.set(path, { path, content, type });
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

  test('2> redirects stderr to file', async () => {
    const script = `#!/bin/sh
nonexistent_cmd 2>/err.txt
`;
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
    const res = await shell.run('sh /test.sh');
    // stderr should have been written to /err.txt
    const files = await mockFileRepo.getProjectFiles(projectId);
    const errFile = files.find((f: any) => f.path === '/err.txt');
    expect(errFile).toBeDefined();
    // Use case-insensitive check for error message
    expect(errFile.content.toLowerCase()).toContain('command not found');
    // returned stderr should be empty
    expect(res.stderr).toBe('');
  });

  test('2>&1 routes stderr to stdout', async () => {
    const script = `#!/bin/sh
nonexistent_cmd 2>&1
`;
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
    const res = await shell.run('sh /test.sh');
    // Use case-insensitive check for error message
    expect(res.stdout.toLowerCase()).toContain('command not found');
    expect(res.stderr).toBe('');
  });

  test('&> writes both stdout and stderr to file', async () => {
    const script = `#!/bin/sh
nonexistent_cmd &> /both.txt
`;
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
    const res = await shell.run('sh /test.sh');
    const files = await mockFileRepo.getProjectFiles(projectId);
    const both = files.find((f: any) => f.path === '/both.txt');
    expect(both).toBeDefined();
    // Use case-insensitive check for error message
    expect(both.content.toLowerCase()).toContain('command not found');
    expect(res.stdout).toBe('');
    expect(res.stderr).toBe('');
  });

  test('1>&2 routes stdout to stderr', async () => {
    const script = `#!/bin/sh
echo "out-msg" 1>&2
`;
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
    const res = await shell.run('sh /test.sh');
    expect(res.stderr).toContain('out-msg');
    expect(res.stdout).not.toContain('out-msg');
  });
});
