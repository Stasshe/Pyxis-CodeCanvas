import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnixCommands } from '@/engine/cmd/global/unix';
import { ShellExecutor } from '@/engine/cmd/shell/executor';
import { fsClient } from '@/engine/core/fs';
import { FsCore } from '@/engine/core/fs/core';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { attachRuntimePort, type RuntimeFilesystem } from '@/engine/runtime/bridge/endpoint';
import { runtimeRegistry } from '@/engine/runtime/core/RuntimeRegistry';
import { NodeRuntimeProvider } from '@/engine/runtime/nodejs/NodeRuntimeProvider';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';
import { disposeRuntimeWorkerPool } from '@/engine/runtime/nodejs/runtimeWorkerPool';
import type { MainMessage, WorkerMessage } from '@/engine/runtime/nodejs/workerProtocol';
import { WorkerStdin } from '@/engine/runtime/nodejs/workerStdin';
import { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import {
  extractCjsDependencies,
  transformEsmToCjs,
} from '@/engine/runtime/transpiler/esmTransformer';
import { directoryTree } from '../../../_helpers/opfs';

vi.mock('@/engine/core/fs', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs')>();
  const { FsClient } =
    await vi.importActual<typeof import('@/engine/core/fs/client')>('@/engine/core/fs/client');
  return { ...original, fsClient: new FsClient() };
});

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(() => ({})),
  readMessage: vi.fn(() => null),
}));
vi.mock('@/engine/runtime/bridge/main', () => ({
  ensureRuntimeBridge: vi.fn(async () => '/'),
  registerRuntimeHost: vi.fn(() => () => {}),
}));

/** Exercise the real runtime and message payloads without a browser worker. */
class RuntimeWorker {
  onmessage: ((event: MessageEvent<WorkerMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  private readonly listeners = new Map<string, Set<EventListener>>();
  private runtime: NodeRuntime | undefined;
  private stdin: WorkerStdin | undefined;
  private bridge: RuntimeBridge | undefined;
  private terminated = false;

  constructor() {
    queueMicrotask(() => this.emit({ type: 'ready' }));
  }

  addEventListener(type: string, listener: EventListener): void {
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  postMessage(message: MainMessage): void {
    if (message.type === 'start') void this.start(message);
    if (message.type === 'stdin') this.stdin?.submit(structuredClone(message.data));
    if (message.type === 'stdin-end') this.stdin?.eof();
  }

  terminate(): void {
    this.terminated = true;
    this.bridge?.close();
  }

  private emit(message: WorkerMessage): void {
    if (!this.terminated) {
      const event = new MessageEvent<WorkerMessage>('message', {
        data: structuredClone(message),
      });
      this.onmessage?.(event);
      for (const listener of this.listeners.get('message') ?? []) listener(event);
    }
  }

  private async start(message: Extract<MainMessage, { type: 'start' }>): Promise<void> {
    try {
      const bridge = new RuntimeBridge(message.scope, message.fsPort, message.runtimeId);
      this.bridge = bridge;
      const stdin = new WorkerStdin(
        promise => this.runtime?.trackIO(promise),
        () => this.emit({ type: 'stdin-request' }),
        () => this.emit({ type: 'stdin-pause' })
      );
      this.stdin = stdin;
      const runtime = new NodeRuntime({
        ...message.options,
        filesystem: new RuntimeFsMount(bridge),
        bridge,
        processStdin: stdin,
        onStdout: text => this.emit({ type: 'output', entries: [{ channel: 'stdout', text }] }),
        onStderr: text => this.emit({ type: 'output', entries: [{ channel: 'stderr', text }] }),
        runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
      });
      this.runtime = runtime;
      await runtime.execute(message.options.filePath, message.options.argv);
      await runtime.waitForEventLoop();
      this.emit({ type: 'complete', result: { exitCode: runtime.getExitCode() } });
    } catch (error) {
      this.emit({ type: 'complete', result: { exitCode: 1, stderr: String(error) } });
    } finally {
      this.bridge?.close();
      this.bridge = undefined;
      this.runtime = undefined;
      this.stdin = undefined;
    }
  }
}

describe('Runtime byte transport through shell pipelines', () => {
  const root = '/tmp/byte-pipeline';
  let core: FsCore;
  let shell: ShellExecutor;
  const channels: MessageChannel[] = [];

  beforeEach(async () => {
    core = new FsCore();
    await core.init(directoryTree());
    vi.spyOn(fsClient, 'readFile').mockImplementation(path => core.readFile(path));
    vi.spyOn(fsClient, 'stat').mockImplementation(path => core.stat(path));
    vi.spyOn(fsClient, 'exists').mockImplementation(path => core.exists(path));
    await core.mkdir(root, { recursive: true });
    vi.stubGlobal('Worker', RuntimeWorker);
    runtimeRegistry.clear();
    runtimeRegistry.registerRuntime(new NodeRuntimeProvider());
    const filesystem: RuntimeFilesystem = {
      readFile: path => core.readFile(path),
      writeFile: (path, data) => core.writeFile(path, data),
      readdir: async path =>
        (await core.readdir(path)).map(entry => entry.path.split('/').pop() ?? ''),
      stat: async path => {
        const entry = await core.stat(path);
        let type: 'file' | 'directory' | 'symlink' = 'file';
        if (entry.type === 'folder') type = 'directory';
        if (entry.type === 'symlink') type = 'symlink';
        return { type, size: entry.size, mtime: entry.mtime };
      },
      lstat: async path => {
        const entry = await core.lstat(path);
        let type: 'file' | 'directory' | 'symlink' = 'file';
        if (entry.type === 'folder') type = 'directory';
        if (entry.type === 'symlink') type = 'symlink';
        return { type, size: entry.size, mtime: entry.mtime };
      },
      readlink: path => core.readlink(path),
      realpath: path => core.realpath(path),
      symlink: (target, path) => core.symlink(target, path),
      mkdir: (path, options) => core.mkdir(path, options),
      rm: (path, options) => core.rm(path, options),
      rename: (path, newPath) => core.rename(path, newPath),
    };
    vi.spyOn(fsClient, 'createRuntimePort').mockImplementation(async () => {
      const channel = new MessageChannel();
      channels.push(channel);
      attachRuntimePort(channel.port1, filesystem, async request => {
        const code = await transformEsmToCjs(request.code, request.filePath);
        return { code, dependencies: extractCjsDependencies(code) };
      });
      return channel.port2;
    });
    shell = new ShellExecutor({ rootPath: root, fsClient: core, unix: new UnixCommands(root) });
  });

  afterEach(() => {
    for (const channel of channels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
    }
    runtimeRegistry.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    return disposeRuntimeWorkerPool();
  });

  it('preserves binary bytes through provider messages, stdin, redirects, and append', async () => {
    await core.writeFile(
      `${root}/produce.js`,
      'process.stdout.write(Buffer.from([9, 0, 255, 128, 9]).subarray(1, 4));'
    );
    await core.writeFile(
      `${root}/copy.js`,
      'process.stdin.on("data", chunk => process.stdout.write(chunk));'
    );
    await core.writeFile(`${root}/copy.bin`, new Uint8Array([42, 255]));
    const result = await shell.run('node produce.js | node copy.js >> copy.bin');
    expect(result.code, result.stderr).toBe(0);
    expect(Array.from(await core.readFile(`${root}/copy.bin`))).toEqual([42, 255, 0, 255, 128]);
    const input = await shell.run('node copy.js < copy.bin > second.bin');
    expect(input.code, input.stderr).toBe(0);
    expect(Array.from(await core.readFile(`${root}/second.bin`))).toEqual(
      Array.from(await core.readFile(`${root}/copy.bin`))
    );
  });

  it('keeps split UTF-8 chunks intact while terminal callbacks receive decoded text', async () => {
    await core.writeFile(
      `${root}/utf8.js`,
      'const bytes = Buffer.from("日本語"); process.stdout.write(bytes.subarray(0, 2)); process.stdout.write(bytes.subarray(2));'
    );
    const displayed: string[] = [];
    const result = await shell.run('node utf8.js', { stdout: text => displayed.push(text) });
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toBe('日本語');
    expect(displayed.join('')).toBe('日本語');
  });
});
