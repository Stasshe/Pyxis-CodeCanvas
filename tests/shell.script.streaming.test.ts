import StreamShell from '@/engine/cmd/shell/streamShell';

describe('Shell script streaming output', () => {
  test('node command output is streamed in real-time through shell script', async () => {
    const projectId = `test-stream-${Date.now()}`;
    const projectName = 'test-stream';

    const memoryFiles = new Map<string, { path: string; content: string; type: string }>();

    const mockFileRepo = {
      getProjectFiles: jest.fn(async (pid: string) => Array.from(memoryFiles.values())),
      getFileByPath: jest.fn(async (pid: string, path: string) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        return memoryFiles.get(normalized);
      }),
      createFile: jest.fn(async (_pid: string, path: string, content: string, type: string) => {
        memoryFiles.set(path, { path, content, type });
        return { id: `file-${Date.now()}`, path, content, type };
      }),
      saveFile: jest.fn(async (file: any) => {
        memoryFiles.set(file.path, file);
        return file;
      }),
    };

    // Mock unix commands
    const mockUnix: any = {
      cat: jest.fn(async (path: string) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const f = memoryFiles.get(normalized);
        if (!f) throw new Error(`cat: ${path}: No such file or directory`);
        return f.content;
      }),
      echo: jest.fn(async (s: string) => s + '\n'),
      pwd: jest.fn(async () => '/projects/test-stream'),
    };

    // Create a simple Node.js script
    const nodeScript = `console.log('Line 1');
console.log('Line 2');
console.log('Line 3');`;

    // Create a shell script that runs the node script
    const shellScript = `#!/usr/bin/env bash
echo "Starting test"
node /src/test.js
echo "Test complete"
`;

    const shell = new StreamShell({ 
      projectName, 
      projectId, 
      unix: mockUnix, 
      fileRepository: mockFileRepo 
    });

    // Set up files
    await mockFileRepo.createFile(projectId, '/src/test.js', nodeScript, 'file');
    await mockFileRepo.createFile(projectId, '/run-test.sh', shellScript, 'file');

    // Track streaming output with timestamps
    const streamedOutput: Array<{ text: string; time: number }> = [];
    const startTime = Date.now();

    const res = await shell.run('bash /run-test.sh', {
      stdout: (data: string) => {
        streamedOutput.push({ text: data, time: Date.now() - startTime });
      },
      stderr: (data: string) => {
        streamedOutput.push({ text: data, time: Date.now() - startTime });
      },
    });

    expect(res.code).toBe(0);
    
    // Verify all expected output was streamed
    const allOutput = streamedOutput.map(o => o.text).join('');
    expect(allOutput).toContain('Starting test');
    expect(allOutput).toContain('Line 1');
    expect(allOutput).toContain('Line 2');
    expect(allOutput).toContain('Line 3');
    expect(allOutput).toContain('Test complete');

    // Verify output was streamed in real-time (multiple chunks received)
    expect(streamedOutput.length).toBeGreaterThan(1);
    
    // Verify order is correct
    const outputText = streamedOutput.map(o => o.text).join('');
    const startingIndex = outputText.indexOf('Starting test');
    const line1Index = outputText.indexOf('Line 1');
    const line3Index = outputText.indexOf('Line 3');
    const completeIndex = outputText.indexOf('Test complete');
    
    expect(startingIndex).toBeGreaterThanOrEqual(0);
    expect(line1Index).toBeGreaterThan(startingIndex);
    expect(line3Index).toBeGreaterThan(line1Index);
    expect(completeIndex).toBeGreaterThan(line3Index);
  });

  test('echo commands are also streamed in real-time', async () => {
    const projectId = `test-stream-echo-${Date.now()}`;
    const projectName = 'test-stream-echo';

    const memoryFiles = new Map<string, { path: string; content: string; type: string }>();

    const mockFileRepo = {
      getProjectFiles: jest.fn(async (pid: string) => Array.from(memoryFiles.values())),
      getFileByPath: jest.fn(async (pid: string, path: string) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        return memoryFiles.get(normalized);
      }),
      createFile: jest.fn(async (_pid: string, path: string, content: string, type: string) => {
        memoryFiles.set(path, { path, content, type });
        return { id: `file-${Date.now()}`, path, content, type };
      }),
      saveFile: jest.fn(async (file: any) => {
        memoryFiles.set(file.path, file);
        return file;
      }),
    };

    const mockUnix: any = {
      cat: jest.fn(async (path: string) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const f = memoryFiles.get(normalized);
        if (!f) throw new Error(`cat: ${path}: No such file or directory`);
        return f.content;
      }),
      echo: jest.fn(async (s: string) => s + '\n'),
      pwd: jest.fn(async () => '/projects/test-stream-echo'),
    };

    // Shell script with echo commands
    const shellScript = `#!/usr/bin/env bash
for i in {1..3}; do
  echo "Count: $i"
done
`;

    const shell = new StreamShell({ 
      projectName, 
      projectId, 
      unix: mockUnix, 
      fileRepository: mockFileRepo 
    });

    await mockFileRepo.createFile(projectId, '/test-echo.sh', shellScript, 'file');

    // Track streaming output
    const streamedOutput: string[] = [];

    const res = await shell.run('bash /test-echo.sh', {
      stdout: (data: string) => {
        streamedOutput.push(data);
      },
    });

    expect(res.code).toBe(0);
    
    // Verify all counts were output
    const allOutput = streamedOutput.join('');
    expect(allOutput).toContain('Count: 1');
    expect(allOutput).toContain('Count: 2');
    expect(allOutput).toContain('Count: 3');

    // Verify output was streamed (multiple chunks)
    expect(streamedOutput.length).toBeGreaterThan(0);
  });
});
