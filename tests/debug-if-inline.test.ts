import { Process } from '../src/engine/cmd/shell/process';
import { runScript } from '../src/engine/cmd/shell/scriptRunner';

class MockShell {
  async run(line: string, opts?: any) {
    const res: any = { stdout: '', stderr: '', code: 0 };
    // very small emulation for echo and true/false
    if (line.startsWith('echo ')) {
      const out = line.slice(5).trim();
      res.stdout = out + '\n';
      if (opts && opts.stdout) opts.stdout(res.stdout);
      return res;
    }
    if (line === 'true') return res;
    if (line === 'false') return { stdout: '', stderr: '', code: 1 };
    // default: command not found
    res.stderr = `command not found: ${line}\n`;
    res.code = 127;
    if (opts && opts.stderr) opts.stderr(res.stderr);
    return res;
  }
}

test('if/elif/else with inline then and trailing commands', async () => {
  const script = `if false; then echo should_not; elif true then echo matched; else echo no; fi`;
  const proc = new Process();
  let out = '';
  proc.stdoutStream.on('data', (c: Buffer) => (out += c.toString()));
  const shell = new MockShell();
  await runScript(script, ['/test.sh'], proc, shell as any);
  // ensure streams are closed so listeners receive 'end'
  try {
    proc.endStdout();
    proc.endStderr();
  } catch {}
  try {
    proc.exit(0);
  } catch {}
  await proc.wait();
  expect(out).toContain('matched');
});
