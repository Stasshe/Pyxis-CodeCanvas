import StreamShell from '@/engine/cmd/shell/streamShell';

describe('Redirection with pwd tests', () => {
  let projectId: string;
  let projectName: string;
  let mockUnix: any;
  let mockFileRepo: any;

  beforeEach(async () => {
    projectId = `test-project-${Date.now()}`;
    projectName = 'test-project';
    let currentDir = `/projects/${projectName}`;

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
      pwd: jest.fn(async () => currentDir),
      cd: jest.fn(async (args: string[]) => {
        // Simulate cd behavior - update currentDir
        const p = args[0];
        if (!p) return '';
        if (p.startsWith('/')) {
          currentDir = p;
        } else {
          const normalizedCwd = currentDir.replace(/\/$/, '');
          currentDir = `${normalizedCwd}/${p}`;
        }
        return '';
      }),
      cat: jest.fn(async (path: string) => {
        const normalized = path.startsWith('/') ? path : `${currentDir}/${path}`;
        const f = memoryFiles.get(normalized);
        if (!f) throw new Error(`cat: ${path}: No such file or directory`);
        return f.content;
      }),
      echo: jest.fn(async (text: string) => text + '\n'),
      ls: jest.fn(async () => ''),
      tree: jest.fn(async () => '.\n└── file1.txt\n'),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('redirection respects pwd when using relative path', async () => {
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    
    // Create a directory structure
    await mockFileRepo.createFile(projectId, `/projects/${projectName}/src/file1.txt`, 'content1', 'file');
    
    // Run command: cd src && echo "test" > out
    const res = await shell.run('cd src && echo "test" > out');
    
    // The file should be created at /projects/test-project/src/out
    const files = await mockFileRepo.getProjectFiles(projectId);
    console.log('Created files:', files.map((f: any) => f.path));
    const outFile = files.find((f: any) => f.path === `/projects/${projectName}/src/out`);
    
    expect(outFile).toBeDefined();
    expect(outFile?.content).toContain('test');
    
    // Make sure it's NOT created at the project root
    const rootOutFile = files.find((f: any) => f.path === `/projects/${projectName}/out`);
    expect(rootOutFile).toBeUndefined();
  });

  test('redirection respects pwd with tree command', async () => {
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    
    // Create a directory structure
    await mockFileRepo.createFile(projectId, `/projects/${projectName}/src/file1.txt`, 'content1', 'file');
    
    // Run command: cd src && tree > out
    const res = await shell.run('cd src && tree > out');
    
    // The file should be created at /projects/test-project/src/out
    const files = await mockFileRepo.getProjectFiles(projectId);
    const outFile = files.find((f: any) => f.path === `/projects/${projectName}/src/out`);
    
    expect(outFile).toBeDefined();
    expect(outFile?.content).toContain('file1.txt');
    
    // Make sure it's NOT created at the project root
    const rootOutFile = files.find((f: any) => f.path === `/projects/${projectName}/out`);
    expect(rootOutFile).toBeUndefined();
  });

  test('absolute path redirection still works correctly', async () => {
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    
    // Run command: cd src && echo "test" > /absolute/path/out
    const res = await shell.run('cd src && echo "test" > /absolute/path/out');
    
    // The file should be created at the absolute path
    const files = await mockFileRepo.getProjectFiles(projectId);
    const outFile = files.find((f: any) => f.path === '/absolute/path/out');
    
    expect(outFile).toBeDefined();
    expect(outFile?.content).toContain('test');
  });

  test('redirection works in nested directories', async () => {
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    
    // Create nested directories
    await mockFileRepo.createFile(projectId, `/projects/${projectName}/a/b/c/file.txt`, 'content', 'file');
    
    // Run command: cd a/b/c && echo "nested" > out.txt
    const res = await shell.run('cd a/b/c && echo "nested" > out.txt');
    
    // The file should be created at /projects/test-project/a/b/c/out.txt
    const files = await mockFileRepo.getProjectFiles(projectId);
    const outFile = files.find((f: any) => f.path === `/projects/${projectName}/a/b/c/out.txt`);
    
    expect(outFile).toBeDefined();
    expect(outFile?.content).toContain('nested');
  });

  test('stderr redirection respects pwd', async () => {
    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });
    
    // Create a directory
    await mockFileRepo.createFile(projectId, `/projects/${projectName}/logs/.keep`, '', 'file');
    
    // Run command: cd logs && nonexistent_cmd 2> error.log
    const res = await shell.run('cd logs && nonexistent_cmd 2> error.log');
    
    // The error file should be created at /projects/test-project/logs/error.log
    const files = await mockFileRepo.getProjectFiles(projectId);
    const errorFile = files.find((f: any) => f.path === `/projects/${projectName}/logs/error.log`);
    
    expect(errorFile).toBeDefined();
    expect(errorFile?.content.toLowerCase()).toContain('command not found');
  });
});
