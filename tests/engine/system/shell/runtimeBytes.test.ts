import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UnixCommands } from '@/engine/system/commands/unix';
import { ShellExecutor } from '@/engine/system/shell/executor';
import { fsClient } from '@/engine/core/fs/index';
import { FsCore } from '@/engine/core/fs/core';
import { attachRuntimePort, type RuntimeFilesystem } from '@/engine/system/runtime/bridge/endpoint';
import { runtimeRegistry } from '@/engine/system/runtime/core/RuntimeRegistry';
import { NodeRuntimeProvider } from '@/engine/system/runtime/nodejs/NodeRuntimeProvider';
import { disposeRuntimeWorkerPool } from '@/engine/system/runtime/nodejs/runtimeWorkerPool';
import { NativeTranspiler } from '../../../_helpers/nodeRuntime';
import { directoryTree } from '../../../_helpers/opfs';
import { prepareRuntimeWorker, RuntimeWorker } from '../../../_helpers/runtimeWorker';

vi.mock('@/engine/core/fs/index', async importOriginal => {
  const original = await importOriginal<typeof import('@/engine/core/fs/index')>();
  const { FsClient } =
    await vi.importActual<typeof import('@/engine/core/fs/client')>('@/engine/core/fs/client');
  return { ...original, fsClient: new FsClient() };
});

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(() => ({})),
  readMessage: vi.fn(() => null),
}));
vi.mock('@/engine/system/runtime/bridge/main', () => ({
  ensureRuntimeBridge: vi.fn(async () => '/'),
  registerRuntimeHost: vi.fn(() => () => {}),
}));

const hostProcess = globalThis.process;
const hostNextTick = hostProcess.nextTick;
const hostTimeout = globalThis.setTimeout;

describe('Runtime byte transport through shell pipelines', () => {
  const root = '/tmp/byte-pipeline';
  let core: FsCore;
  let shell: ShellExecutor;
  let transpiler: NativeTranspiler;
  const channels: MessageChannel[] = [];

  beforeEach(async () => {
    await prepareRuntimeWorker();
    transpiler = await NativeTranspiler.create();
    await transpiler.transform({ kind: 'transpile', code: '', filePath: '/fixture.mjs' });
    core = new FsCore();
    await core.init(directoryTree());
    vi.spyOn(fsClient, 'readFile').mockImplementation(path => core.readFile(path));
    vi.spyOn(fsClient, 'stat').mockImplementation(path => core.stat(path));
    vi.spyOn(fsClient, 'exists').mockImplementation(path => core.exists(path));
    vi.spyOn(fsClient, 'closeFifos').mockImplementation(ownerId => core.closeFifos(ownerId));
    await core.mkdir(root, { recursive: true });
    vi.stubGlobal('Worker', RuntimeWorker);
    runtimeRegistry.clear();
    runtimeRegistry.registerRuntime(new NodeRuntimeProvider());
    const filesystem: RuntimeFilesystem = {
      readFile: (path, _benchmark, ownerId) => core.readFile(path, ownerId),
      writeFile: (path, data, _benchmark, ownerId, mode) =>
        core.writeFile(path, data, { mode }, true, ownerId),
      writeRange: (path, data, position, create, exclusive, _benchmark, mode) =>
        core.writeRange(path, data, position, create, exclusive, mode),
      openFifo: (path, mode, endpointId, ownerId, options) =>
        core.openFifo(path, mode, endpointId, ownerId, options),
      readFifo: (endpointId, maxBytes) => core.readFifo(endpointId, maxBytes),
      writeFifo: (endpointId, bytes) => core.writeFifo(endpointId, bytes),
      closeFifo: endpointId => core.closeFifo(endpointId),
      readdir: async path =>
        (await core.readdir(path)).map(entry => entry.path.split('/').pop() ?? ''),
      stat: async path => {
        const entry = await core.stat(path);
        let type: 'file' | 'directory' | 'symlink' = 'file';
        if (entry.type === 'folder') type = 'directory';
        if (entry.type === 'symlink') type = 'symlink';
        return { type, size: entry.size, mtime: entry.mtime, mode: entry.mode };
      },
      lstat: async path => {
        const entry = await core.lstat(path);
        let type: 'file' | 'directory' | 'symlink' = 'file';
        if (entry.type === 'folder') type = 'directory';
        if (entry.type === 'symlink') type = 'symlink';
        return { type, size: entry.size, mtime: entry.mtime, mode: entry.mode };
      },
      readlink: path => core.readlink(path),
      realpath: path => core.realpath(path),
      symlink: (target, path) => core.symlink(target, path),
      mkdir: (path, options) => core.mkdir(path, options),
      chmod: (path, mode) => core.chmod(path, mode),
      rm: (path, options) => core.rm(path, options),
      rename: (path, newPath) => core.rename(path, newPath),
    };
    vi.spyOn(fsClient, 'createRuntimePort').mockImplementation(async () => {
      const channel = new MessageChannel();
      channels.push(channel);
      attachRuntimePort(channel.port1, filesystem, request => transpiler.transform(request));
      return channel.port2;
    });
    shell = new ShellExecutor({ rootPath: root, fsClient: core, unix: new UnixCommands(root) });
  });

  afterEach(async () => {
    await disposeRuntimeWorkerPool();
    await RuntimeWorker.closeAll();
    for (const channel of channels.splice(0)) {
      channel.port1.close();
      channel.port2.close();
    }
    runtimeRegistry.clear();
    transpiler.close();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    expect(globalThis.process).toBe(hostProcess);
    expect(hostProcess.nextTick).toBe(hostNextTick);
    expect(globalThis.setTimeout).toBe(hostTimeout);
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

  it.each([
    { name: 'last pipeline command status', prefix: '', code: 0 },
    { name: 'pipefail status', prefix: 'set -o pipefail; ', code: 1 },
  ])('routes a closed descriptor diagnostic through a FIFO stderr redirect ($name)', async test => {
    const fifoPath = `${root}/diagnostics-${test.code}.fifo`;
    const outputPath = `${root}/diagnostics-${test.code}.txt`;
    await core.mkfifo(fifoPath);
    const fifoName = fifoPath.slice(fifoPath.lastIndexOf('/') + 1);
    const outputName = outputPath.slice(outputPath.lastIndexOf('/') + 1);

    const result = await shell.run(
      `${test.prefix}printf 'closed' >&- 2> ${fifoName} | cat < ${fifoName} > ${outputName}`
    );

    expect(result.code).toBe(test.code);
    expect(result.stderr).toBe('');
    expect(new TextDecoder().decode(await core.readFile(outputPath))).toContain(
      'Redirection failed: Bad file descriptor'
    );
  });
});
