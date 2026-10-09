/** Creates the built-in modules exposed to one Node runtime worker. */

import stream from 'node:stream';
import * as buffer from 'buffer';
import { HOME_DIR } from '@/engine/core/paths';
import type { RuntimeBridge } from '@/engine/system/runtime/bridge/client';
import type { RuntimeFsMount } from '@/engine/system/runtime/fs/RuntimeFsMount';
import type { RuntimeStdin } from '@/engine/system/runtime/nodejs/workerStdin';
import { createAssertModule } from './modules/assertModule';
import {
  type ChildProcessModuleOptions,
  createChildProcessModule,
} from './modules/childProcessModule';
import { createConstantsModule } from './modules/constantsModule';
import { createCryptoModule } from './modules/cryptoModule';
import { createDiagnosticsChannelModule } from './modules/diagnosticsChannel';
import { createEventsModule } from './modules/eventsModule';
import { createFSModule, type FSModuleOptions } from './modules/fsModule';
import { createHTTPModule, createHTTPSModule } from './modules/httpModule';
import { createModuleModule } from './modules/moduleModule';
import * as netModule from './modules/netModule';
import { createOSModule } from './modules/osModule';
import { createPathModule } from './modules/pathModule';
import * as querystringModule from './modules/querystringModule';
import { createRuntimeStreamModule } from './modules/readableWebAdapters';
import { createReadlineModule, createReadlinePromisesModule } from './modules/readlineModule';
import * as stringDecoderModule from './modules/stringDecoderModule';
import { createTTYModule } from './modules/ttyModule';
import * as urlModule from './modules/urlModule';
import { createUrlModule } from './modules/urlModule';
import { createUtilModule } from './modules/utilModule';
import { createV8Module } from './modules/v8Module';
import { createWebStreamsModule } from './modules/webStreamsModule';
import { createWorkerThreadsModule } from './modules/workerThreadsModule';
import { createZlibModule } from './modules/zlibModule';

export interface BuiltInModulesOptions {
  rootPath: string;
  bridge: RuntimeBridge;
  processStdin?: RuntimeStdin;
  getTrackIO?: () => (<T>(p: Promise<T>) => Promise<T>) | undefined;
  requireFactory: (filename: string) => (id: string) => unknown;
  scheduleNextTick: (callback: () => void) => void;
  getCwd?: () => string;
  getEnv?: () => Record<string, string>;
  runShell?: ChildProcessModuleOptions['runShell'];
  filesystem: RuntimeFsMount;
  writeStdout: (data: string | Uint8Array) => void;
  writeStderr: (data: string | Uint8Array) => void;
  terminalColumns?: number;
  terminalRows?: number;
  stdoutIsTTY?: boolean;
}

export interface BuiltInModules {
  url: ReturnType<typeof createUrlModule>;
  stream: typeof stream;
  webStreams: ReturnType<typeof createWebStreamsModule>;
  worker_threads: ReturnType<typeof createWorkerThreadsModule>;
  fs: ReturnType<typeof createFSModule>;
  path: ReturnType<typeof createPathModule>;
  os: ReturnType<typeof createOSModule>;
  util: ReturnType<typeof createUtilModule>;
  http: ReturnType<typeof createHTTPModule>;
  https: ReturnType<typeof createHTTPSModule>;
  events: ReturnType<typeof createEventsModule>;
  buffer: typeof buffer;
  readline: ReturnType<typeof createReadlineModule>;
  readlinePromises: ReturnType<typeof createReadlinePromisesModule>;
  string_decoder: typeof stringDecoderModule;
  querystring: typeof querystringModule;
  tty: ReturnType<typeof createTTYModule>;
  assert: ReturnType<typeof createAssertModule>;
  module: ReturnType<typeof createModuleModule>;
  net: typeof netModule;
  v8: ReturnType<typeof createV8Module>;
  crypto: ReturnType<typeof createCryptoModule>;
  diagnostics_channel: ReturnType<typeof createDiagnosticsChannelModule>;
  child_process: ReturnType<typeof createChildProcessModule>;
  constants: ReturnType<typeof createConstantsModule>;
  zlib: ReturnType<typeof createZlibModule>;
}

/** Creates the built-in modules for one runtime worker. */
export function createBuiltInModules(options: BuiltInModulesOptions): BuiltInModules {
  const {
    rootPath,
    bridge,
    processStdin,
    getTrackIO,
    requireFactory,
    scheduleNextTick,
    getCwd,
    getEnv,
    runShell,
    filesystem,
    writeStdout,
    writeStderr,
    terminalColumns,
    terminalRows,
    stdoutIsTTY,
  } = options;
  const runtimeStream = createRuntimeStreamModule();

  return {
    fs: createFSModule({
      filesystem,
      bridge,
      getTrackIO,
      getCwd: getCwd ?? (() => rootPath),
      writeStdout,
      writeStderr,
    }),
    path: createPathModule(getCwd ?? (() => rootPath)),
    os: createOSModule(HOME_DIR),
    util: createUtilModule({
      getEnv,
      isStream: value => value instanceof runtimeStream.Stream,
      stdoutIsTTY,
    }),
    http: createHTTPModule(getTrackIO),
    https: createHTTPSModule(getTrackIO),
    events: createEventsModule(),
    buffer,
    readline: createReadlineModule(processStdin, getTrackIO),
    readlinePromises: createReadlinePromisesModule(processStdin, getTrackIO),
    querystring: querystringModule,
    string_decoder: stringDecoderModule,
    tty: createTTYModule(terminalColumns, terminalRows, enabled =>
      processStdin?.setRawMode(enabled)
    ),
    assert: createAssertModule(),
    module: createModuleModule(requireFactory),
    net: netModule,
    url: createUrlModule(getCwd ?? (() => rootPath)),
    stream: runtimeStream,
    webStreams: createWebStreamsModule(),
    worker_threads: createWorkerThreadsModule(),
    v8: createV8Module(),
    crypto: createCryptoModule(getTrackIO),
    diagnostics_channel: createDiagnosticsChannelModule(scheduleNextTick),
    child_process: createChildProcessModule({
      runShell,
      writeStdout,
      writeStderr,
      runShellSync: (command, shellOptions) => {
        const value = bridge.sync({
          kind: 'shell',
          command,
          cwd: shellOptions?.cwd ?? (getCwd ?? (() => rootPath))(),
          env: shellOptions?.env ?? getEnv?.(),
        });
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
          throw new Error('Synchronous shell bridge returned invalid data.');
        }
        if (!('stdout' in value) || !('stderr' in value) || !('exitCode' in value)) {
          throw new Error('Synchronous shell bridge returned invalid data.');
        }
        const isOutput = (output: unknown): output is string | Uint8Array | number[] =>
          typeof output === 'string' ||
          output instanceof Uint8Array ||
          (Array.isArray(output) && output.every(byte => typeof byte === 'number'));
        if (
          !isOutput(value.stdout) ||
          !isOutput(value.stderr) ||
          typeof value.exitCode !== 'number'
        ) {
          throw new Error('Synchronous shell bridge returned invalid data.');
        }
        return { stdout: value.stdout, stderr: value.stderr, exitCode: value.exitCode };
      },
      getCwd,
      getEnv,
      getTrackIO,
      maxParallel: 2,
    }),
    constants: createConstantsModule(),
    zlib: createZlibModule(getTrackIO),
  };
}

/** Export the built-in module options type. */
export type { FSModuleOptions };
/** Export module constructors for focused runtime use. */
export {
  buffer,
  createAssertModule,
  createChildProcessModule,
  createConstantsModule,
  createEventsModule,
  createFSModule,
  createHTTPModule,
  createHTTPSModule,
  createModuleModule,
  createOSModule,
  createPathModule,
  createReadlineModule,
  createTTYModule,
  createUtilModule,
  createZlibModule,
  stream,
  urlModule,
};
