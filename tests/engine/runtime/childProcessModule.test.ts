import { Buffer } from 'buffer';
import { describe, expect, it } from 'vitest';
import { createChildProcessModule } from '@/engine/runtime/nodejs/modules/childProcessModule';

describe('child_process module', () => {
  it('exec runs through the injected shell runner and calls back', async () => {
    const childProcess = createChildProcessModule({
      runShell: async command => ({
        stdout: `ran:${command}`,
        stderr: '',
        code: 0,
      }),
      getCwd: () => '/projects/Test',
      getEnv: () => ({ PATH: '/bin' }),
    });

    const result = await new Promise<{ err: Error | null; stdout: unknown; stderr: unknown }>(
      resolve => {
        childProcess.exec('echo ok', (err, stdout, stderr) => {
          resolve({ err, stdout, stderr });
        });
      }
    );

    expect(result.err).toBeNull();
    expect(result.stdout).toBe('ran:echo ok');
    expect(result.stderr).toBe('');
  });

  it('limits async spawn execution concurrency', async () => {
    let active = 0;
    let maxActive = 0;
    const childProcess = createChildProcessModule({
      maxParallel: 1,
      runShell: async command => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        active--;
        return { stdout: command, stderr: '', code: 0 };
      },
    });

    const exits = ['a', 'b', 'c'].map(
      command =>
        new Promise<number | null>(resolve => {
          childProcess.spawn(command).on('close', code => resolve(code));
        })
    );

    await Promise.all(exits);

    expect(maxActive).toBe(1);
  });

  it('streams child stdin into the shell runner and emits spawn asynchronously', async () => {
    const input: Buffer[] = [];
    const events: string[] = [];
    const childProcess = createChildProcessModule({
      runShell: async (_command, options) => {
        const stdin = options?.stdin;
        if (!stdin) throw new Error('Child stdin was not connected.');
        return new Promise(resolve => {
          stdin.on('data', chunk => input.push(Buffer.from(chunk)));
          stdin.once('end', () => resolve({ stdout: '', stderr: '', code: 0 }));
        });
      },
    });

    const child = childProcess.spawn('command');
    child.once('spawn', () => events.push('spawn'));
    child.once('exit', () => events.push('exit'));
    child.once('close', () => events.push('close'));
    expect(events).toEqual([]);
    child.stdin.end(Buffer.from('stdin 日本語'));

    await new Promise<void>(resolve => child.once('close', () => resolve()));
    expect(Buffer.concat(input).toString('utf8')).toBe('stdin 日本語');
    expect(events).toEqual(['spawn', 'exit', 'close']);
  });

  it('runs synchronous commands through the host shell bridge', () => {
    let received: { command: string; cwd?: string; env?: Record<string, string> } | undefined;
    const childProcess = createChildProcessModule({
      getCwd: () => '/work',
      getEnv: () => ({ PATH: '/bin' }),
      runShellSync: (command, options) => {
        received = { command, cwd: options?.cwd, env: options?.env };
        return { stdout: 'result', stderr: 'warning', exitCode: 7 };
      },
    });
    const result = childProcess.spawnSync('tool', ['--flag'], { encoding: 'utf8' });

    expect(received).toEqual({
      command: 'tool --flag',
      cwd: '/work',
      env: { PATH: '/bin' },
    });
    expect(result.status).toBe(7);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toBe('result');
    expect(result.stderr).toBe('warning');
  });

  it('decodes synchronous byte output using the requested encoding', () => {
    const childProcess = createChildProcessModule({
      runShellSync: () => ({
        stdout: new TextEncoder().encode('runtime11-sync-arg 日本語'),
        stderr: new TextEncoder().encode('失敗'),
        exitCode: 9,
      }),
    });

    const textResult = childProcess.spawnSync('tool', [], { encoding: 'utf8' });
    expect(textResult.stdout).toBe('runtime11-sync-arg 日本語');
    expect(textResult.stderr).toBe('失敗');
    expect(textResult.status).toBe(9);

    const bufferResult = childProcess.spawnSync('tool', [], { encoding: 'buffer' });
    expect(Buffer.isBuffer(bufferResult.stdout)).toBe(true);
    expect((bufferResult.stdout as Buffer).toString('utf8')).toBe('runtime11-sync-arg 日本語');
  });

  it('does not apply exec maxBuffer limits to spawn output', async () => {
    const childProcess = createChildProcessModule({
      runShell: async (_command, options) => {
        options?.onStdout?.('output');
        return { stdout: 'output', stderr: '', code: 0 };
      },
    });
    const child = childProcess.spawn('command', [], { maxBuffer: 1 });
    const output = new Promise<string>(resolve => {
      child.stdout.on('data', chunk => resolve(String(chunk)));
    });
    const close = new Promise<void>(resolve => child.once('close', () => resolve()));

    expect(await output).toBe('output');
    await close;
    expect(child.exitCode).toBe(0);
  });

  it('applies maxBuffer to exec output', async () => {
    const childProcess = createChildProcessModule({
      runShell: async (_command, options) => {
        options?.onStdout?.('output');
        return { stdout: 'output', stderr: '', code: 0 };
      },
    });
    const result = await new Promise<{ error: Error | null; stdout: unknown }>(resolve => {
      childProcess.exec('command', { maxBuffer: 1 }, (error, stdout) => resolve({ error, stdout }));
    });

    expect(result.error?.message).toBe('stdout maxBuffer length exceeded');
    expect(result.stdout).toBe('output');
  });

  it('streams inherited output to the runtime and exposes no child pipes', async () => {
    const output: string[] = [];
    const childProcess = createChildProcessModule({
      writeStdout: value => output.push(String(value)),
      runShell: async (_command, options) => {
        options?.onStdout?.('first');
        options?.onStdout?.('second');
        return { stdout: 'firstsecond', stderr: '', code: 0 };
      },
    });
    const child = childProcess.spawn('command', [], { stdio: 'inherit' });
    const close = new Promise<number | null>(resolve => child.once('close', resolve));

    expect(child.stdout).toBeNull();
    expect(await close).toBe(0);
    expect(output).toEqual(['first', 'second']);
  });

  it('aborts the active shell and closes with the requested signal on kill', async () => {
    const childProcess = createChildProcessModule({
      runShell: async (_command, options) => {
        await Promise.resolve();
        return new Promise(resolve => {
          options?.signal?.addEventListener(
            'abort',
            () => resolve({ stdout: '', stderr: '', code: null }),
            { once: true }
          );
        });
      },
    });
    const child = childProcess.spawn('command');
    const close = new Promise<{ code: number | null; signal: string | null }>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });

    expect(child.kill('SIGTERM')).toBe(true);
    await expect(close).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(child.killed).toBe(true);
  });

  it('emits spawn before exit when killed before the shell starts', async () => {
    const childProcess = createChildProcessModule({
      runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
    });
    const child = childProcess.spawn('command');
    const events: string[] = [];
    child.on('spawn', () => events.push('spawn'));
    child.on('error', () => events.push('error'));
    child.on('exit', () => events.push('exit'));
    child.on('close', () => events.push('close'));
    const closed = new Promise<void>(resolve => child.once('close', resolve));

    expect(events).toEqual([]);
    expect(child.kill()).toBe(true);
    await closed;
    expect(events).toEqual(['spawn', 'exit', 'close']);
  });

  it('asynchronously reports an already-aborted spawn without running the shell', async () => {
    const controller = new AbortController();
    controller.abort('stop now');
    let ran = false;
    const childProcess = createChildProcessModule({
      runShell: async () => {
        ran = true;
        return { stdout: '', stderr: '', code: 0 };
      },
    });
    const child = childProcess.spawn('command', [], { signal: controller.signal });
    const errors: Array<Error & { code?: string | number }> = [];
    const events: string[] = [];
    child.once('spawn', () => events.push('spawn'));
    child.once('error', error => {
      events.push('error');
      errors.push(error as Error & { code?: string | number });
    });
    child.once('exit', () => events.push('exit'));
    child.once('close', () => events.push('close'));
    const closed = new Promise<{ code: number | null; signal: string | null }>(resolve => {
      child.once('close', (code, signal) => resolve({ code, signal }));
    });

    await expect(closed).resolves.toEqual({ code: null, signal: 'SIGTERM' });
    expect(ran).toBe(false);
    expect(errors).toHaveLength(1);
    expect(errors[0]?.name).toBe('AbortError');
    expect(errors[0]?.code).toBe('ABORT_ERR');
    expect(errors[0]?.cause).toBe('stop now');
    expect(events).toEqual(['spawn', 'error', 'exit', 'close']);
  });

  it('returns Buffer output when encoding is null', async () => {
    const childProcess = createChildProcessModule({
      runShell: async () => ({ stdout: 'output', stderr: 'error', code: 0 }),
    });

    const result = await new Promise<{ stdout: unknown; stderr: unknown }>(resolve => {
      childProcess.exec('command', { encoding: null }, (_error, stdout, stderr) => {
        resolve({ stdout, stderr });
      });
    });

    expect(Buffer.isBuffer(result.stdout)).toBe(true);
    expect(Buffer.isBuffer(result.stderr)).toBe(true);
  });
});
