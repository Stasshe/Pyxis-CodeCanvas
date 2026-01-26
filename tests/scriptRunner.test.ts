import { runScript } from '../src/engine/cmd/shell/scriptRunner';
import { Process } from '../src/engine/cmd/shell/process';

describe('scriptRunner nested for loops', () => {
  test('inner loop runs for each outer iteration', async () => {
    const script = `for i in 1 2; do
  echo outer-$i
  for k in 1 2; do
    echo inner-$i-$k
  done
done
`;

    const proc = new Process();

    let out = '';
    proc.stdout.on('data', (chunk: Buffer | string) => {
      out += String(chunk);
    });

    // Minimal mock shell that handles `echo` and returns streaming callbacks.
    const mockShell: any = {
      async run(line: string, callbacks?: any) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return { stdout: '', stderr: '', code: 0 };
        const parts = trimmed.split(/\s+/);
        if (parts[0] === 'echo') {
          const txt = parts.slice(1).join(' ') + '\n';
          if (callbacks?.stdout) callbacks.stdout(txt);
          return { stdout: txt, stderr: '', code: 0 };
        }
        // fallback: no output, success
        return { stdout: '', stderr: '', code: 0 };
      },
    };

    await runScript(script, ['script'], proc, mockShell);

    // runScript does not call proc.exit in this path, so close streams
    proc.endStdout();
    proc.endStderr();
    proc.exit(0);

    await proc.wait();

    const expected =
      'outer-1\ninner-1-1\ninner-1-2\nouter-2\ninner-2-1\ninner-2-2\n';

    expect(out).toBe(expected);
  });

  test('two inner for-loops both run for each outer iteration', async () => {
    const script = `for i in 1 2; do
  echo outer-$i
  for k in 1 2; do
    echo innerA-$i-$k
  done
  for k in 1 2; do
    echo innerB-$i-$k
  done
done
`;

    const proc = new Process();
    let out = '';
    proc.stdout.on('data', (chunk: Buffer | string) => {
      out += String(chunk);
    });

    const mockShell: any = {
      async run(line: string, callbacks?: any) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return { stdout: '', stderr: '', code: 0 };
        const parts = trimmed.split(/\s+/);
        if (parts[0] === 'echo') {
          const txt = parts.slice(1).join(' ') + '\n';
          if (callbacks?.stdout) callbacks.stdout(txt);
          return { stdout: txt, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    };

    await runScript(script, ['script'], proc, mockShell);
    proc.endStdout();
    proc.endStderr();
    proc.exit(0);
    await proc.wait();

    const expected =
      'outer-1\ninnerA-1-1\ninnerA-1-2\ninnerB-1-1\ninnerB-1-2\nouter-2\ninnerA-2-1\ninnerA-2-2\ninnerB-2-1\ninnerB-2-2\n';

    expect(out).toBe(expected);
  });

  test('two sequential inner for-loops (md2) work correctly', async () => {
    const script = `for i in 1 2; do
  echo outer-$i
  for j in 1 2; do
    echo mid-$i-$j
  done
  for k in 1 2; do
    echo mid2-$i-$k
  done
done
`;

    const proc = new Process();
    let out = '';
    proc.stdout.on('data', (chunk: Buffer | string) => {
      out += String(chunk);
    });

    const mockShell: any = {
      async run(line: string, callbacks?: any) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return { stdout: '', stderr: '', code: 0 };
        const parts = trimmed.split(/\s+/);
        if (parts[0] === 'echo') {
          const txt = parts.slice(1).join(' ') + '\n';
          if (callbacks?.stdout) callbacks.stdout(txt);
          return { stdout: txt, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    };

    await runScript(script, ['script'], proc, mockShell);
    proc.endStdout();
    proc.endStderr();
    proc.exit(0);
    await proc.wait();

    const expected =
      'outer-1\nmid-1-1\nmid-1-2\nmid2-1-1\nmid2-1-2\nouter-2\nmid-2-1\nmid-2-2\nmid2-2-1\nmid2-2-2\n';

    expect(out).toBe(expected);
  });

  test('nested inner for inside inner for works correctly', async () => {
    const script = `for i in 1 2; do
  echo outer-$i
  for j in 1 2; do
    echo mid-$i-$j
    for k in 1 2; do
      echo inner-$i-$j-$k
    done
  done
done
`;

    const proc = new Process();
    let out = '';
    proc.stdout.on('data', (chunk: Buffer | string) => {
      out += String(chunk);
    });

    const mockShell: any = {
      async run(line: string, callbacks?: any) {
        const trimmed = String(line || '').trim();
        if (!trimmed) return { stdout: '', stderr: '', code: 0 };
        const parts = trimmed.split(/\s+/);
        if (parts[0] === 'echo') {
          const txt = parts.slice(1).join(' ') + '\n';
          if (callbacks?.stdout) callbacks.stdout(txt);
          return { stdout: txt, stderr: '', code: 0 };
        }
        return { stdout: '', stderr: '', code: 0 };
      },
    };

    await runScript(script, ['script'], proc, mockShell);
    proc.endStdout();
    proc.endStderr();
    proc.exit(0);
    await proc.wait();

    const expected =
      'outer-1\nmid-1-1\ninner-1-1-1\ninner-1-1-2\nmid-1-2\ninner-1-2-1\ninner-1-2-2\nouter-2\nmid-2-1\ninner-2-1-1\ninner-2-1-2\nmid-2-2\ninner-2-2-1\ninner-2-2-2\n';

    expect(out).toBe(expected);
  });
});
