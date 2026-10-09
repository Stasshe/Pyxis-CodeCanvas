import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';
import type { RpcValue, TranspileRequest } from '@/engine/runtime/bridge/protocol';
import type {
  RuntimeExecutionOptions,
  RuntimeExecutionResult,
} from '@/engine/runtime/core/RuntimeProvider';
import { NativeTranspiler } from './nodeRuntime';

export interface RuntimeFile {
  path: string;
  data: Uint8Array;
}

export type IsolatedRuntimeMessage =
  | { type: 'stdout' | 'stderr'; data: string | Uint8Array }
  | { type: 'console'; channel: 'log' | 'warn' | 'error' | 'clear'; text: string }
  | { type: 'transpile'; id: number; request: TranspileRequest }
  | { type: 'complete'; result: RuntimeExecutionResult };

export type IsolatedRuntimeRequest =
  | {
      type: 'start';
      rootPath: string;
      cwd?: string;
      filePath: string;
      argv?: string[];
      source?: string;
      execArgv?: string[];
      stdinIsTTY: boolean;
      files: RuntimeFile[];
    }
  | { type: 'stdin'; data: Uint8Array }
  | { type: 'stdin-end' }
  | { type: 'transpiled'; id: number; value: RpcValue }
  | { type: 'transpile-error'; id: number; error: string };

let workerBundle: Promise<string> | undefined;

async function buildWorkerBundle(): Promise<string> {
  if (!workerBundle) {
    workerBundle = build({
      entryPoints: [fileURLToPath(new URL('./isolatedNodeWorker.ts', import.meta.url))],
      bundle: true,
      write: false,
      platform: 'node',
      format: 'cjs',
      tsconfig: 'tsconfig.json',
      external: ['esbuild'],
      define: {
        'import.meta.env': JSON.stringify({ BASE_URL: '/', PROD: false }),
        __PYXIS_VERSION__: JSON.stringify('test'),
      },
      plugins: [
        {
          name: 'fixture-sync-message',
          setup(builder) {
            builder.onResolve({ filter: /^sync-message$/ }, () => ({
              path: 'sync-message',
              namespace: 'fixture',
            }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
              contents:
                'export const makeServiceWorkerChannel = () => ({}); export const readMessage = () => null;',
            }));
          },
        },
      ],
    }).then(result => {
      const output = result.outputFiles[0];
      if (!output) throw new Error('Esbuild did not produce the isolated runtime bundle.');
      return output.text;
    });
  }
  return workerBundle;
}

/** Concurrent shell stages need separate globals, just like production runtime Workers. */
export async function executeIsolatedNodeRuntime(
  options: RuntimeExecutionOptions,
  files: RuntimeFile[]
): Promise<RuntimeExecutionResult> {
  const input: IsolatedRuntimeRequest[] = [];
  let worker: Worker | undefined;
  let transpiler: NativeTranspiler | undefined;
  const post = (message: IsolatedRuntimeRequest) => {
    if (worker) worker.postMessage(message);
    else input.push(message);
  };
  const onData = (data: Uint8Array) => post({ type: 'stdin', data });
  const onEnd = () => post({ type: 'stdin-end' });
  options.processStdin?.on('data', onData);
  options.processStdin?.on('end', onEnd);
  try {
    const bundle = await buildWorkerBundle();
    const compiler = await NativeTranspiler.create();
    transpiler = compiler;
    worker = new Worker(bundle, { eval: true });
    const runtimeWorker = worker;
    const completion = new Promise<RuntimeExecutionResult>((resolve, reject) => {
      runtimeWorker.on('message', (message: IsolatedRuntimeMessage) => {
        if (message.type === 'complete') resolve(message.result);
        else if (message.type === 'stdout') options.onStdout?.(message.data);
        else if (message.type === 'stderr') options.onStderr?.(message.data);
        else if (message.type === 'console') {
          if (message.channel === 'clear') options.debugConsole?.clear();
          else options.debugConsole?.[message.channel](message.text);
        } else if (message.type === 'transpile') {
          void compiler.transform(message.request).then(
            value => runtimeWorker.postMessage({ type: 'transpiled', id: message.id, value }),
            error =>
              runtimeWorker.postMessage({
                type: 'transpile-error',
                id: message.id,
                error: String(error),
              })
          );
        }
      });
      runtimeWorker.on('error', reject);
      runtimeWorker.on('exit', code => {
        reject(new Error(`Isolated runtime worker exited before completion: ${code}.`));
      });
    });
    post({
      type: 'start',
      rootPath: options.rootPath,
      cwd: options.cwd,
      filePath: options.filePath,
      argv: options.argv,
      source: options.source,
      execArgv: options.execArgv,
      stdinIsTTY: options.processStdin?.isTTY === true,
      files,
    });
    for (const message of input) post(message);
    input.length = 0;
    return await completion;
  } finally {
    options.processStdin?.removeListener('data', onData);
    options.processStdin?.removeListener('end', onEnd);
    await worker?.terminate();
    transpiler?.close();
  }
}
