import { createChildProcessModule } from '@/engine/runtime/nodejs/modules/childProcessModule';
import { describe, expect, it } from 'vitest';

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

  it('supports common synchronous detection commands', () => {
    const childProcess = createChildProcessModule({ getCwd: () => '/work' });
    const result = childProcess.spawnSync('node', ['--version'], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('v18.0.0\n');
  });
});
