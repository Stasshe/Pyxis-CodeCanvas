import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProcessStdin } from '@/engine/system/terminal/terminalProcessBridge';
import { terminalCommandRegistry } from '@/engine/system/terminal/terminalRegistry';
import { fsClient } from '@/engine/core/fs/index';
import type { FsCore } from '@/engine/core/fs/core';
import type {
  RuntimeExecutionOptions,
  RuntimeProvider,
} from '@/engine/system/runtime/core/RuntimeProvider';
import { runtimeRegistry } from '@/engine/system/runtime/core/RuntimeRegistry';
import { projectState } from '@/stores/projectStore';
import {
  executeIsolatedNodeRuntime,
  type RuntimeFile,
} from '../../../_helpers/isolatedNodeRuntime';
import { setupTestProject } from '../../../_helpers/testProject';

describe('StreamShell node builtin', () => {
  let rootPath: string;
  let repo: Awaited<ReturnType<typeof setupTestProject>>['repo'];

  beforeEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    const context = await setupTestProject('ShellNodeBuiltinTest');
    rootPath = context.rootPath;
    repo = context.repo;
    projectState.currentRootPath = rootPath;
    vi.spyOn(fsClient, 'readFile').mockImplementation(path => repo.readFile(path));
    vi.spyOn(fsClient, 'readText').mockImplementation(path => repo.readText(path));
    vi.spyOn(fsClient, 'writeFile').mockImplementation((path, data) => repo.writeFile(path, data));
    vi.spyOn(fsClient, 'readdir').mockImplementation(path => repo.readdir(path));
    vi.spyOn(fsClient, 'stat').mockImplementation(path => repo.stat(path));
    vi.spyOn(fsClient, 'mkdir').mockImplementation((path, options) => repo.mkdir(path, options));
    vi.spyOn(fsClient, 'rm').mockImplementation((path, options) => repo.rm(path, options));
    vi.spyOn(fsClient, 'rename').mockImplementation((oldPath, newPath) =>
      repo.rename(oldPath, newPath)
    );
    vi.spyOn(fsClient, 'walk').mockImplementation(path => repo.walk(path));
    vi.spyOn(fsClient, 'exists').mockImplementation(path => repo.exists(path));
    runtimeRegistry.registerRuntime(createTestRuntimeProvider(repo));
  });

  afterEach(async () => {
    await terminalCommandRegistry.clearAll();
    runtimeRegistry.clear();
    projectState.currentRootPath = null;
    vi.restoreAllMocks();
  });

  async function readBytes(path: string): Promise<number[]> {
    return Array.from(await repo.readFile(path));
  }

  it('executes a JavaScript file passed as a relative path from the project root', async () => {
    await repo.writeFile(
      `${rootPath}/src/relative-node-entry.js`,
      "console.log('relative entry ok');"
    );

    const shell = await terminalCommandRegistry.getShell(rootPath);
    const result = await shell!.run('node src/relative-node-entry.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stderr).not.toContain('Cannot find module');
    expect(result.stdout).toContain('relative entry ok');
  });

  it('executes inline JavaScript with node -e', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    const result = await shell!.run('node -e "console.log(6 * 7)"');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('42');
    const evalResult = await shell!.run('node --eval "console.log(42)"');
    expect(evalResult.code, evalResult.stderr).toBe(0);
    expect(evalResult.stdout).toContain('42');
  });

  it('exposes inline evaluation arguments without leaking them into file executions', async () => {
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const evalSource = 'console.log(JSON.stringify(process.execArgv))';

    const shortFlag = await shell.run(`node -e "${evalSource}"`);
    expect(shortFlag.code, shortFlag.stderr).toBe(0);
    expect(shortFlag.stdout.trim()).toBe(JSON.stringify(['-e', evalSource]));

    const longFlag = await shell.run(`node --eval "${evalSource}"`);
    expect(longFlag.code, longFlag.stderr).toBe(0);
    expect(longFlag.stdout.trim()).toBe(JSON.stringify(['--eval', evalSource]));

    await repo.writeFile(
      `${rootPath}/exec-argv.js`,
      'console.log(JSON.stringify(process.execArgv));'
    );
    const fileExecution = await shell.run('node exec-argv.js');
    expect(fileExecution.code, fileExecution.stderr).toBe(0);
    expect(fileExecution.stdout.trim()).toBe('[]');
  });

  it('preserves binary bytes through node pipes, redirects, and append', async () => {
    const bytes = new Uint8Array([0, 255, 128]);
    await repo.writeFile(
      `${rootPath}/produce.js`,
      'process.stdout.write(Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4));'
    );
    await repo.writeFile(
      `${rootPath}/copy.js`,
      'process.stdin.on("data", chunk => process.stdout.write(chunk));'
    );
    await repo.writeFile(`${rootPath}/existing.bin`, new Uint8Array([42, 255]));
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const first = await shell.run('node produce.js | node copy.js > copy.bin');
    expect(first.code, first.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/copy.bin`)).toEqual(Array.from(bytes));
    const second = await shell.run('node produce.js >> existing.bin');
    expect(second.code, second.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/existing.bin`)).toEqual([42, 255, 0, 255, 128]);
    await repo.writeFile(`${rootPath}/encoded.js`, 'process.stdout.write("00ff80", "hex");');
    const encoded = await shell.run('node encoded.js > encoded.bin');
    expect(encoded.code, encoded.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/encoded.bin`)).toEqual(Array.from(bytes));
    const fromFile = await shell.run('node copy.js < copy.bin > from-file.bin');
    expect(fromFile.code, fromFile.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/from-file.bin`)).toEqual(Array.from(bytes));
  });

  it('isolates globals when a producer runs after its consumer is ready', async () => {
    const hostProcess = process;
    const hostQueueMicrotask = queueMicrotask;
    const pipe = new PassThrough();
    const output: number[] = [];
    let ready: () => void = () => {};
    const consumerReady = new Promise<void>(resolve => {
      ready = resolve;
    });
    const consumer = executeIsolatedNodeRuntime(
      {
        rootPath,
        filePath: `${rootPath}/copy.js`,
        processStdin: new ProcessStdin(pipe, false),
        onStdout: data => {
          if (typeof data === 'string') throw new Error('Expected binary output.');
          output.push(...data);
          ready();
        },
      },
      [
        {
          path: `${rootPath}/copy.js`,
          data: new TextEncoder().encode(
            'process.stdin.on("data", chunk => process.stdout.write(chunk)); process.stdout.write(Buffer.from([9]));'
          ),
        },
      ]
    );
    await consumerReady;
    try {
      expect(process).toBe(hostProcess);
      expect(queueMicrotask).toBe(hostQueueMicrotask);
      const producer = await executeIsolatedNodeRuntime(
        {
          rootPath,
          filePath: `${rootPath}/produce.js`,
          onStdout: data => pipe.write(data),
        },
        [
          {
            path: `${rootPath}/produce.js`,
            data: new TextEncoder().encode('process.stdout.write(Buffer.from([0, 255, 128]));'),
          },
        ]
      );
      expect(producer.exitCode, producer.stderr).toBe(0);
    } finally {
      pipe.end();
    }
    const result = await consumer;
    expect(result.exitCode, result.stderr).toBe(0);
    expect(output).toEqual([9, 0, 255, 128]);
    expect(process).toBe(hostProcess);
    expect(queueMicrotask).toBe(hostQueueMicrotask);
  });

  it('copies cat bytes without decoding or adding a newline', async () => {
    await repo.writeFile(`${rootPath}/raw.txt`, new Uint8Array([0, 255, 128]));
    await repo.writeFile(`${rootPath}/tail.bin`, new Uint8Array([239, 187, 191, 65]));
    await repo.writeFile(
      `${rootPath}/copy.js`,
      'process.stdin.on("data", chunk => process.stdout.write(chunk));'
    );
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const copy = await shell.run('cat raw.txt > cat-copy.bin');
    expect(copy.code, copy.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/cat-copy.bin`)).toEqual([0, 255, 128]);
    const joined = await shell.run('cat raw.txt tail.bin | node copy.js > cat-pipe.bin');
    expect(joined.code, joined.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/cat-pipe.bin`)).toEqual([0, 255, 128, 239, 187, 191, 65]);
    const appended = await shell.run('cat tail.bin >> cat-copy.bin');
    expect(appended.code, appended.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/cat-copy.bin`)).toEqual([0, 255, 128, 239, 187, 191, 65]);
  });

  it('flushes binary redirects for each logical group before the next command', async () => {
    await repo.writeFile(`${rootPath}/first.js`, 'process.stdout.write(Buffer.from([0, 255]));');
    await repo.writeFile(`${rootPath}/second.js`, 'process.stdout.write(Buffer.from([128, 42]));');
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const result = await shell.run('node first.js > first.bin && node second.js > second.bin');
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('');
    expect(await readBytes(`${rootPath}/first.bin`)).toEqual([0, 255]);
    expect(await readBytes(`${rootPath}/second.bin`)).toEqual([128, 42]);
    const failed = await shell.run(
      'node first.js > missing/first.bin && node second.js > skipped.bin'
    );
    expect(failed.code).toBe(1);
    expect(failed.stderr).toContain('Redirection failed');
    expect(await repo.exists(`${rootPath}/skipped.bin`)).toBe(false);
  });

  it('keeps separate and merged output descriptor redirections byte exact', async () => {
    await repo.writeFile(
      `${rootPath}/descriptors.js`,
      'process.stdout.write(Buffer.from([0, 255])); process.stderr.write(Buffer.from([128])); process.stdout.write(Buffer.from([42]));'
    );
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const separate = await shell.run('node descriptors.js > stdout.bin 2> stderr.bin');
    expect(separate.code, separate.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/stdout.bin`)).toEqual([0, 255, 42]);
    expect(await readBytes(`${rootPath}/stderr.bin`)).toEqual([128]);
    const merged = await shell.run('node descriptors.js &> merged.bin');
    expect(merged.code, merged.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/merged.bin`)).toEqual([0, 255, 128, 42]);
    const duplicated = await shell.run('node descriptors.js > duplicated.bin 2>&1');
    expect(duplicated.code, duplicated.stderr).toBe(0);
    expect(duplicated.stderr).toBe('');
    expect(await readBytes(`${rootPath}/duplicated.bin`)).toEqual([0, 255, 128, 42]);
  });

  it('does not execute a command when input redirection fails', async () => {
    await repo.writeFile(`${rootPath}/must-not-run.js`, 'process.stdout.write("executed");');
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const missing = await shell.run('node must-not-run.js < missing.bin');
    expect(missing.code).toBe(1);
    expect(missing.stderr).toContain('Input redirection failed');
    expect(missing.stdout).toBe('');
    const failure = Object.assign(new Error('Read failed'), { code: 'EIO' });
    vi.spyOn(repo, 'readFile').mockRejectedValueOnce(failure);
    const ioError = await shell.run('node must-not-run.js < must-not-run.js');
    expect(ioError.code).toBe(1);
    expect(ioError.stderr).toContain('Read failed');
    expect(ioError.stdout).toBe('');
  });

  it('decodes split UTF-8 only for terminal display and preserves file bytes', async () => {
    await repo.writeFile(
      `${rootPath}/utf8.js`,
      'const bytes = Buffer.from("日本語"); process.stdout.write(bytes.subarray(0, 2)); process.stdout.write(bytes.subarray(2));'
    );
    const shell = await terminalCommandRegistry.getShell(rootPath);
    if (!shell) throw new Error('Shell unavailable');
    const displayed: string[] = [];
    const result = await shell.run('node utf8.js', { stdout: text => displayed.push(text) });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('日本語');
    expect(displayed.join('')).toBe('日本語');
    const redirected = await shell.run('node utf8.js > utf8.txt');
    expect(redirected.code, redirected.stderr).toBe(0);
    expect(await readBytes(`${rootPath}/utf8.txt`)).toEqual(
      Array.from(new TextEncoder().encode('日本語'))
    );
  });

  it('sets process.cwd() to the terminal working directory', async () => {
    await repo.writeFile(`${rootPath}/src/cwd-node-entry.js`, 'console.log(process.cwd());');

    const shell = await terminalCommandRegistry.getShell(rootPath);
    await shell!.run('cd src');
    const result = await shell!.run('node cwd-node-entry.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain(`${rootPath}/src`);
  });

  it('exposes runtime process.cwd() through global objects', async () => {
    await repo.writeFile(
      `${rootPath}/src/global-cwd-node-entry.js`,
      [
        'console.log(global.process.cwd());',
        'console.log(globalThis.process.cwd());',
        "console.log(require('process').cwd());",
      ].join('\n')
    );

    const shell = await terminalCommandRegistry.getShell(rootPath);
    await shell!.run('cd src');
    const result = await shell!.run('node global-cwd-node-entry.js');

    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout.match(new RegExp(rootPath + '/src', 'g'))).toHaveLength(3);
  });
});

function createTestRuntimeProvider(repo: FsCore): RuntimeProvider {
  return {
    id: 'nodejs',
    name: 'Node.js test runtime',
    supportedExtensions: ['.js', '.mjs', '.cjs'],
    canExecute: path => /\.(js|mjs|cjs)$/.test(path),
    async execute(options: RuntimeExecutionOptions) {
      const files: RuntimeFile[] = [];
      for (const entry of await repo.walk(options.rootPath)) {
        if (entry.type === 'file') {
          files.push({ path: entry.path, data: await repo.readFile(entry.path) });
        }
      }
      return executeIsolatedNodeRuntime(options, files);
    },
  };
}
