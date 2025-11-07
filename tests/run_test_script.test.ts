import fs from 'fs/promises';
import path from 'path';
import StreamShell from '../src/engine/cmd/shell/streamShell';

test('run initial_files/run-test.sh via StreamShell', async () => {
  const projectRoot = path.resolve(__dirname, '..');
  const runTestPath = path.join(projectRoot, 'initial_files', 'run-test.sh');
  const fileContent = await fs.readFile(runTestPath, 'utf8');

  // minimal unix mock implementing cat and pwd (used by StreamShell)
  const unixMock: any = {
    cat: async (p: string) => {
      // allow relative paths from repository root
      try {
        const full = path.isAbsolute(p) ? p : path.join(projectRoot, p);
        return await fs.readFile(full, 'utf8');
      } catch (e) {
        return null;
      }
    },
    pwd: async () => '/',
    // chmod used in script; noop
    chmod: async () => {},
  };

  const shell = new StreamShell({ projectName: 'p', projectId: 'p', unix: unixMock });
  const res = await shell.run(`sh ${runTestPath}`);
  // script prints a final summary line
  expect(res.code).toBe(0);
  expect(res.stdout + res.stderr).toContain('run-test.sh finished successfully');
}, 20000);
