import { parentPort } from 'node:worker_threads';
import { RuntimeBridge } from '@/engine/system/runtime/bridge/client';
import { attachRuntimePort } from '@/engine/system/runtime/bridge/endpoint';
import type { RpcValue, TranspileRequest } from '@/engine/system/runtime/bridge/protocol';
import { formatRuntimeArgs, setRuntimeLogSink } from '@/engine/system/runtime/core/runtimeLogger';
import { NodeRuntime } from '@/engine/system/runtime/nodejs/nodeRuntime';
import { WorkerStdin } from '@/engine/system/runtime/nodejs/workerStdin';
import { RuntimeFsMount } from '@/engine/system/runtime/fs/RuntimeFsMount';
import type { IsolatedRuntimeMessage, IsolatedRuntimeRequest } from './isolatedNodeRuntime';
import { MemoryFs } from './memoryFs';

if (!parentPort) throw new Error('Isolated runtime requires a parent port.');
const port = parentPort;
const input: Array<Extract<IsolatedRuntimeRequest, { type: 'stdin' | 'stdin-end' }>> = [];
const transforms = new Map<
  number,
  { resolve(value: RpcValue): void; reject(error: Error): void }
>();
let nextTransformId = 0;
let stdin: WorkerStdin | undefined;

function post(message: IsolatedRuntimeMessage): void {
  port.postMessage(message);
}

function transpile(request: TranspileRequest): Promise<RpcValue> {
  const id = nextTransformId++;
  return new Promise((resolve, reject) => {
    transforms.set(id, { resolve, reject });
    post({ type: 'transpile', id, request });
  });
}

function submit(message: Extract<IsolatedRuntimeRequest, { type: 'stdin' | 'stdin-end' }>) {
  if (!stdin) {
    input.push(message);
    return;
  }
  if (message.type === 'stdin') stdin.submit(message.data);
  else stdin.eof();
}

async function start(message: Extract<IsolatedRuntimeRequest, { type: 'start' }>) {
  const fs = new MemoryFs();
  const channel = new MessageChannel();
  const bridge = new RuntimeBridge('/', channel.port2, 'isolated-fixture', () => {});
  bridge.sync = request => fs.sync(request);
  attachRuntimePort(channel.port1, fs, transpile);
  setRuntimeLogSink(() => {});
  let runtime: NodeRuntime | undefined;
  try {
    await fs.mkdir(message.rootPath, { recursive: true });
    for (const file of message.files) {
      const parent = file.path.slice(0, file.path.lastIndexOf('/')) || '/';
      await fs.mkdir(parent, { recursive: true });
      await fs.writeFile(file.path, file.data);
    }
    stdin = new WorkerStdin(
      promise => runtime?.trackIO(promise),
      () => {},
      () => {},
      () => {},
      message.stdinIsTTY
    );
    runtime = new NodeRuntime({
      rootPath: message.rootPath,
      cwd: message.cwd,
      filePath: message.filePath,
      bridge,
      filesystem: new RuntimeFsMount(bridge),
      processStdin: stdin,
      onStdout: data => post({ type: 'stdout', data }),
      onStderr: data => post({ type: 'stderr', data }),
      debugConsole: {
        log: (...args) => post({ type: 'console', channel: 'log', text: formatRuntimeArgs(args) }),
        warn: (...args) =>
          post({ type: 'console', channel: 'warn', text: formatRuntimeArgs(args) }),
        error: (...args) =>
          post({ type: 'console', channel: 'error', text: formatRuntimeArgs(args) }),
        clear: () => post({ type: 'console', channel: 'clear', text: '' }),
      },
      runShell: async () => ({ stdout: '', stderr: '', code: 0 }),
      onExit: () => runtime?.dispose(),
    });
    for (const message of input) submit(message);
    input.length = 0;
    await runtime.execute(message.filePath, message.argv, message.source, message.execArgv);
    await runtime.waitForEventLoop();
    post({ type: 'complete', result: { exitCode: runtime.getExitCode() } });
  } catch (error) {
    post({ type: 'complete', result: { exitCode: 1, stderr: String(error) } });
  } finally {
    runtime?.dispose();
    stdin?.dispose();
    bridge.close();
    channel.port1.close();
  }
}

port.on('message', (message: IsolatedRuntimeRequest) => {
  if (message.type === 'start') void start(message);
  else if (message.type === 'stdin' || message.type === 'stdin-end') submit(message);
  else {
    const transform = transforms.get(message.id);
    transforms.delete(message.id);
    if (message.type === 'transpiled') transform?.resolve(message.value);
    else transform?.reject(new Error(message.error));
  }
});
