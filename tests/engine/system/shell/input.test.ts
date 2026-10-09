import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ShellJobs } from '@/engine/system/shell/jobs';
import { terminalProcessBridge } from '@/engine/system/terminal/terminalProcessBridge';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import type {
  RuntimeExecutionOptions,
  RuntimeProvider,
} from '@/engine/system/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/system/runtime/core/RuntimeRegistry';
import { setupTestProject } from '../../../_helpers/testProject';

describe('StreamShell terminal input routing', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    const project = await setupTestProject('ShellInputTest');
    rootPath = project.rootPath;
    repo = project.repo;
  });

  afterEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    vi.restoreAllMocks();
  });

  async function writeReadScript(): Promise<void> {
    await repo.writeFile(`${rootPath}/package.json`, JSON.stringify({ scripts: { read: 'cat' } }));
  }

  it('routes terminal lines and EOF to a foreground cat', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run('cat');

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    terminalProcessBridge.submitLine('hello');
    terminalProcessBridge.stdin.eof();

    const result = await resultPromise;
    expect(result.stdout).toBe('hello\n');
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it.each([
    ['grep', "grep '^hello$'", 'hello\nworld\n', 'hello\n'],
    ['wc', 'wc -l', 'first\nsecond\n', '2\n'],
    ['sort', 'sort', 'zeta\nalpha\n', 'alpha\nzeta\n'],
  ])('routes terminal input to %s', async (_name, command, input, expected) => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run(command);

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    for (const line of input.trimEnd().split('\n')) {
      terminalProcessBridge.submitLine(line);
    }
    terminalProcessBridge.stdin.eof();

    const result = await resultPromise;
    expect(result.stdout).toBe(expected);
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it.each([
    'cat',
    'grep x',
    'wc',
    'sort',
    'read VALUE',
    'while read VALUE; do printf "%s\\n" "$VALUE"; done',
  ])('returns 130 and releases terminal input when %s is interrupted', async command => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run(command);

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    shell.killForeground('SIGINT');

    const result = await resultPromise;
    expect(result.code).toBe(130);
    expect(terminalProcessBridge.isActive()).toBe(false);

    const nextResult = await shell.run('echo ready');
    expect(nextResult.stdout).toBe('ready\n');
    expect(nextResult.code).toBe(0);
  });

  it('does not claim terminal input for cat with an input redirection', async () => {
    await repo.writeFile(`${rootPath}/input.txt`, 'from-file\n');
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const activate = vi.spyOn(terminalProcessBridge, 'activate');
    const result = await shell.run('cat < input.txt');

    expect(result.stdout).toBe('from-file\n');
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  });

  it('keeps redirected while-read input away from the terminal in an interactive script', async () => {
    await repo.writeFile(`${rootPath}/lines.txt`, 'one\ntwo');
    await repo.writeFile(
      `${rootPath}/read-loop.sh`,
      'while read -r line || [ -n "$line" ]; do printf "<%s>\\n" "$line"; done < lines.txt\n'
    );
    const shell = await terminalCommandRegistry.getShell(rootPath);
    shell.setEnv('IFS', '');
    const activate = vi.spyOn(terminalProcessBridge, 'activate');

    const result = await shell.run('bash read-loop.sh');

    expect(result.stdout).toBe('<one>\n<two>\n');
    expect(result.code).toBe(0);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('does not claim terminal input for a background cat', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const activate = vi.spyOn(terminalProcessBridge, 'activate');
    const result = await shell.run('cat & wait');

    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
    // `wait` is foreground; the background `cat` must not acquire its own lease.
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('releases terminal input after a non-reader command completes', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const result = await shell.run('echo done');

    expect(result.stdout).toBe('done\n');
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('passes pipeline input to an npm script', async () => {
    await writeReadScript();
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const result = await shell.run("printf 'piped\\n' | npm run read");

    expect(result.stdout.match(/piped\n/g)).toHaveLength(1);
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('passes redirected input to an npm script without claiming terminal input', async () => {
    await writeReadScript();
    await repo.writeFile(`${rootPath}/input.txt`, 'from-file\n');
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const activate = vi.spyOn(terminalProcessBridge, 'activate');
    const result = await shell.run('npm run read < input.txt');

    expect(result.stdout.match(/from-file\n/g)).toHaveLength(1);
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
    expect(activate).not.toHaveBeenCalled();
  });

  it('does not let a background npm reader claim the foreground wait input', async () => {
    await writeReadScript();
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const activate = vi.spyOn(terminalProcessBridge, 'activate');
    const result = await shell.run('npm run read & wait');

    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
    // `wait` is foreground; the background npm script must not acquire a lease.
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('routes terminal lines and EOF through an interactive npm script', async () => {
    await writeReadScript();
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run('npm run read');

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    terminalProcessBridge.submitLine('interactive');
    terminalProcessBridge.stdin.eof();

    const result = await resultPromise;
    expect(result.stdout.match(/interactive\n/g)).toHaveLength(1);
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('keeps npm script cwd and environment changes inside the script', async () => {
    await repo.writeFile(
      `${rootPath}/package.json`,
      JSON.stringify({ scripts: { change: 'cd src; export NPM_SCOPE=child' } })
    );
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const result = await shell.run('npm run change; pwd');

    expect(result.stdout.endsWith(`${rootPath}\n`)).toBe(true);
    expect(shell.getEnv('NPM_SCOPE')).toBeUndefined();
    expect(result.code).toBe(0);
  });

  it('lets a runtime ignore SIGINT and aborts it on a later SIGTERM', async () => {
    await repo.writeFile(`${rootPath}/wait.js`, '');
    const runtimeStarted = deferred<void>();
    const backendStopped = deferred<void>();
    let interruptCount = 0;
    let executionSignal: AbortSignal | undefined;

    runtimeRegistry.registerRuntime({
      id: 'nodejs',
      name: 'Shell input abort test runtime',
      supportedExtensions: ['.js'],
      canExecute: path => path.endsWith('.js'),
      async execute(options) {
        if (!options.signal) throw new Error('Runtime did not receive an abort signal.');
        executionSignal = options.signal;
        options.subscribeInterrupt?.(() => {
          interruptCount += 1;
        });
        runtimeStarted.resolve();
        await new Promise<void>(resolve => {
          const finish = () => {
            backendStopped.resolve();
            resolve();
          };
          options.signal?.addEventListener('abort', finish, { once: true });
          if (options.signal?.aborted) finish();
        });
        return { exitCode: 130 };
      },
    });

    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run('node wait.js');
    await runtimeStarted.promise;

    shell.killForeground('SIGINT');
    expect(interruptCount).toBe(1);
    expect(executionSignal?.aborted).toBe(false);
    expect(terminalProcessBridge.isActive()).toBe(true);

    shell.killForeground('SIGTERM');
    await backendStopped.promise;
    const result = await resultPromise;

    expect(executionSignal?.aborted).toBe(true);
    expect(result.code).toBe(143);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('returns from an interrupted wait without consuming the background job', async () => {
    await repo.writeFile(`${rootPath}/wait.js`, '');
    const runtimeStarted = deferred<void>();
    const waitStarted = deferred<void>();
    const releaseRuntime = deferred<void>();
    const runtimeFinished = deferred<void>();
    runtimeRegistry.registerRuntime({
      id: 'nodejs',
      name: 'Shell background wait test runtime',
      supportedExtensions: ['.js'],
      canExecute: path => path.endsWith('.js'),
      async execute(options) {
        if (!options.signal) throw new Error('Runtime did not receive an abort signal.');
        runtimeStarted.resolve();
        await new Promise<void>(resolve => {
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            options.signal?.removeEventListener('abort', finish);
            runtimeFinished.resolve();
            resolve();
          };
          releaseRuntime.promise.then(finish);
          options.signal?.addEventListener('abort', finish, { once: true });
          if (options.signal?.aborted) finish();
        });
        let exitCode = 0;
        if (options.signal.aborted) exitCode = 143;
        return { exitCode };
      },
    });

    const shell = await terminalCommandRegistry.getShell(rootPath);
    const waitImplementation = ShellJobs.prototype.wait;
    const waitSpy = vi.spyOn(ShellJobs.prototype, 'wait').mockImplementation(function (
      this: ShellJobs,
      ...arguments_
    ) {
      waitStarted.resolve();
      return waitImplementation.apply(this, arguments_);
    });
    const launched = await shell.run('node wait.js & echo pid:$!');
    const pidLine = launched.stdout.split('\n').find(line => line.startsWith('pid:'));
    const pid = pidLine?.slice('pid:'.length);
    expect(pid).toMatch(/^\d+$/);
    const runPromise = shell.run(`wait "${pid}"`);
    await runtimeStarted.promise;
    await waitStarted.promise;
    shell.killForeground('SIGINT');

    const interrupted = await runPromise;
    expect(interrupted.code).toBe(130);

    const ready = await shell.run('echo ready');
    expect(ready.stdout).toBe('ready\n');
    expect(ready.code).toBe(0);

    releaseRuntime.resolve();
    await runtimeFinished.promise;
    waitSpy.mockRestore();
    const waited = await shell.run(`wait ${pid}`);
    expect(waited.code).toBe(0);
  });

  it('returns promptly from interrupted xargs and disposes its ignored-signal child', async () => {
    await repo.writeFile(`${rootPath}/xargs-child.js`, '');
    const runtimeStarted = deferred<void>();
    const backendStopped = deferred<void>();
    const runtimeFinished = deferred<void>();
    let interruptCount = 0;
    let runtimeFinishedValue = false;
    let emitLateOutput: (() => void) | undefined;
    runtimeRegistry.registerRuntime({
      id: 'nodejs',
      name: 'Shell xargs interrupt test runtime',
      supportedExtensions: ['.js'],
      canExecute: path => path.endsWith('.js'),
      async execute(options) {
        if (!options.signal) throw new Error('Runtime did not receive an abort signal.');
        options.subscribeInterrupt?.(() => {
          interruptCount += 1;
        });
        emitLateOutput = () => options.onStdout?.('late child output\n');
        runtimeStarted.resolve();
        await new Promise<void>(resolve => {
          const finish = () => {
            backendStopped.resolve();
            resolve();
          };
          options.signal?.addEventListener('abort', finish, { once: true });
          if (options.signal?.aborted) finish();
        });
        runtimeFinishedValue = true;
        runtimeFinished.resolve();
        return { exitCode: 143 };
      },
    });

    const shell = await terminalCommandRegistry.getShell(rootPath);
    const lateOutput: string[] = [];
    const runPromise = shell.run('printf "argument\\n" | xargs node xargs-child.js', {
      stdout: output => lateOutput.push(output),
    });
    await runtimeStarted.promise;
    shell.killForeground('SIGINT');

    const interrupted = await runPromise;
    expect(interrupted.code).toBe(130);
    expect(interruptCount).toBe(1);
    expect(runtimeFinishedValue).toBe(false);
    emitLateOutput?.();
    expect(lateOutput.join('')).toContain('late child output\n');

    const next = await shell.run('echo ready');
    expect(next.stdout).toBe('ready\n');
    expect(next.code).toBe(0);

    shell.dispose();
    await backendStopped.promise;
    await runtimeFinished.promise;
  });

  it('preserves the foreground runtime input lease when a background runtime exits', async () => {
    await repo.writeFile(`${rootPath}/background.js`, '');
    await repo.writeFile(`${rootPath}/foreground.js`, '');

    const backgroundStarted = deferred<void>();
    const foregroundStarted = deferred<void>();
    const backgroundFinished = deferred<void>();
    let backgroundStdin: RuntimeExecutionOptions['processStdin'];
    let foregroundInput = '';

    const runtime: RuntimeProvider = {
      id: 'nodejs',
      name: 'Shell input test runtime',
      supportedExtensions: ['.js'],
      canExecute: path => path.endsWith('.js'),
      async execute(options) {
        if (options.filePath.endsWith('/background.js')) {
          backgroundStdin = options.processStdin;
          backgroundStarted.resolve();
          await backgroundFinished.promise;
          return { exitCode: 0 };
        }

        const stdin = options.processStdin;
        if (!stdin) throw new Error('Foreground runtime did not receive stdin.');
        stdin.setRawMode(true);
        stdin.on('data', chunk => {
          foregroundInput += chunk.toString('utf8');
        });
        const inputEnded = new Promise<void>(resolve => stdin.on('end', resolve));
        foregroundStarted.resolve();
        await inputEnded;
        return { exitCode: 0 };
      },
    };
    runtimeRegistry.registerRuntime(runtime);

    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run('node background.js & node foreground.js');
    await Promise.all([backgroundStarted.promise, foregroundStarted.promise]);

    const stdin = terminalProcessBridge.stdin;
    expect(stdin.isRaw).toBe(true);
    expect(terminalProcessBridge.isActive()).toBe(true);
    backgroundFinished.resolve();
    await vi.waitFor(() => expect(backgroundStdin?._active).toBe(false));

    expect(terminalProcessBridge.stdin).toBe(stdin);
    expect(terminalProcessBridge.isActive()).toBe(true);
    expect(stdin.isRaw).toBe(true);
    terminalProcessBridge.submitData('foreground input');
    terminalProcessBridge.stdin.eof();

    const result = await resultPromise;
    expect(foregroundInput).toBe('foreground input');
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('routes terminal EOF through a nested cat', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run('(cat)');

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    terminalProcessBridge.submitLine('nested');
    terminalProcessBridge.stdin.eof();

    const result = await resultPromise;
    expect(result.stdout).toBe('nested\n');
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });

  it('restores terminal ownership for a later reader after cat exits', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const resultPromise = shell.run('cat; cat');

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    terminalProcessBridge.submitLine('first');
    terminalProcessBridge.stdin.eof();

    await vi.waitFor(() => expect(terminalProcessBridge.isActive()).toBe(true));
    terminalProcessBridge.submitLine('second');
    terminalProcessBridge.stdin.eof();

    const result = await resultPromise;
    expect(result.stdout).toBe('first\nsecond\n');
    expect(result.code).toBe(0);
    expect(terminalProcessBridge.isActive()).toBe(false);
  });
});

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => {};
  const promise = new Promise<T>(resolve => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}
