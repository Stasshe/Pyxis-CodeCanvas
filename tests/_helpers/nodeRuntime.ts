import { vi } from 'vitest';
import { RuntimeBridge } from '@/engine/runtime/bridge/client';
import { attachRuntimePort } from '@/engine/runtime/bridge/endpoint';
import type { RpcValue, TranspileRequest } from '@/engine/runtime/bridge/protocol';
import { NodeRuntime } from '@/engine/runtime/nodejs/nodeRuntime';
import { WorkerStdin } from '@/engine/runtime/nodejs/workerStdin';
import { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import {
  extractCjsDependencies,
  transformEsmToCjs,
} from '@/engine/runtime/transpiler/esmTransformer';
import { MemoryFs } from './memoryFs';

vi.mock('sync-message', () => ({
  makeServiceWorkerChannel: vi.fn(() => ({})),
  readMessage: vi.fn(() => null),
}));

export interface NodeRuntimeFixture {
  runtime: NodeRuntime;
  rootPath: string;
  bridge: RuntimeBridge;
  filesystem: RuntimeFsMount;
  fs: MemoryFs;
  close(): void;
  writeFile(path: string, content: string | Uint8Array): Promise<void>;
}

export interface RuntimeDebugConsole {
  log: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  clear: () => void;
}

export async function createNodeRuntimeFixture(
  rootPath = '/tmp/runtime-tests',
  debugConsole?: RuntimeDebugConsole,
  cwd = rootPath,
  onExit?: (code: number) => void,
  sharedFs?: MemoryFs
): Promise<NodeRuntimeFixture> {
  const fs = sharedFs ?? new MemoryFs();
  await fs.mkdir(rootPath, { recursive: true });
  const channel = new MessageChannel();
  const bridge = new RuntimeBridge('/', channel.port2, crypto.randomUUID());
  const transpile = async (request: TranspileRequest): Promise<RpcValue> => {
    const code = await transformEsmToCjs(request.code, request.filePath, {
      isTypeScript: request.isTypeScript,
      isJSX: request.isJSX,
    });
    return { code, dependencies: extractCjsDependencies(code) };
  };
  attachRuntimePort(channel.port1, fs, transpile);
  vi.spyOn(bridge, 'sync').mockImplementation(request => fs.sync(request));
  const filesystem = new RuntimeFsMount(bridge);
  const runtime = new NodeRuntime({
    rootPath,
    cwd,
    filePath: `${rootPath}/entry.js`,
    bridge,
    filesystem,
    runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
    processStdin: new WorkerStdin(
      () => {},
      () => {},
      () => {}
    ),
    debugConsole,
    onExit,
  });
  return {
    runtime,
    rootPath,
    bridge,
    filesystem,
    fs,
    close() {
      bridge.close();
      channel.port1.close();
    },
    async writeFile(path, content) {
      const parent = path.slice(0, path.lastIndexOf('/')) || '/';
      await fs.mkdir(parent, { recursive: true });
      const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
      await fs.writeFile(path, data);
    },
  };
}
