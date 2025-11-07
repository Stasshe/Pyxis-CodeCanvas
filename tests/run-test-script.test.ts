import StreamShell from '@/engine/cmd/shell/streamShell';

describe('Shebang + set -euo pipefail script', () => {
  test('bash script with for-loop printing Japanese counts runs', async () => {
    const projectId = `test-run-${Date.now()}`;
    const projectName = 'test-run';

    const memoryFiles = new Map<string, { path: string; content: string; type: string }>();

    const mockFileRepo = {
      getProjectFiles: jest.fn(async (pid: string) => Array.from(memoryFiles.values())),
      createFile: jest.fn(async (_pid: string, path: string, content: string, type: string) => {
        memoryFiles.set(path, { path, content, type });
        return { id: `file-${Date.now()}`, path, content, type };
      }),
      saveFile: jest.fn(async (file: any) => {
        memoryFiles.set(file.path, file);
        return file;
      }),
    };

    // Minimal unix mock: cat and echo are needed by the shell runner
    const mockUnix: any = {
      cat: jest.fn(async (path: string) => {
        const normalized = path.startsWith('/') ? path : `/${path}`;
        const f = memoryFiles.get(normalized);
        if (!f) throw new Error(`cat: ${path}: No such file or directory`);
        return f.content;
      }),
      echo: jest.fn(async (s: string) => s + '\n'),
    };

    const script = `#!/usr/bin/env bash
set -euo pipefail

for i in {1..5}; do
  echo "カウント: $i"
done
`;

    const shell = new StreamShell({ projectName, projectId, unix: mockUnix, fileRepository: mockFileRepo });

    await mockFileRepo.createFile(projectId, '/run-test.sh', script, 'file');
    const res = await shell.run('bash /run-test.sh');

    expect(res.code).toBe(0);
    for (let i = 1; i <= 5; i++) {
      expect(res.stdout).toContain(`カウント: ${i}`);
    }
  });
});
