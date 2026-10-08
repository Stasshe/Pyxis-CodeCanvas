/** Creates the built-in modules exposed to one Node runtime worker. */

import * as stream from 'node:stream';
import * as buffer from 'buffer';
import { HOME_DIR } from '@/engine/core/pathUtils';
import type { RuntimeBridge } from '@/engine/runtime/bridge/client';
import type { RuntimeStdin } from '@/engine/runtime/nodejs/workerStdin';
import type { RuntimeFsMount } from '@/engine/runtime/storage/RuntimeFsMount';
import { createAssertModule } from './modules/assertModule';
import { createChildProcessModule } from './modules/childProcessModule';
import { createConstantsModule } from './modules/constantsModule';
import { createCryptoModule } from './modules/cryptoModule';
import { createEventsModule } from './modules/eventsModule';
import { createFSModule, type FSModuleOptions } from './modules/fsModule';
import { createHTTPModule, createHTTPSModule } from './modules/httpModule';
import { createModuleModule } from './modules/moduleModule';
import * as netModule from './modules/netModule';
import { createOSModule } from './modules/osModule';
import { createPathModule } from './modules/pathModule';
import * as querystringModule from './modules/querystringModule';
import { createReadlineModule } from './modules/readlineModule';
import * as stringDecoderModule from './modules/stringDecoderModule';
import { createTTYModule } from './modules/ttyModule';
import * as urlModule from './modules/urlModule';
import { createUtilModule } from './modules/utilModule';
import { createV8Module } from './modules/v8Module';
import { createZlibModule } from './modules/zlibModule';

export interface BuiltInModulesOptions {
  rootPath: string;
  bridge: RuntimeBridge;
  processStdin?: RuntimeStdin;
  getTrackIO?: () => (<T>(p: Promise<T>) => Promise<T>) | undefined;
  requireFactory?: (filename: string) => (id: string) => unknown;
  getCwd?: () => string;
  getEnv?: () => Record<string, string>;
  runShell?: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string> }
  ) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  filesystem: RuntimeFsMount;
  writeStdout: (data: string | Uint8Array) => void;
  writeStderr: (data: string | Uint8Array) => void;
  terminalColumns?: number;
  terminalRows?: number;
}

export interface BuiltInModules {
  url: typeof urlModule;
  stream: typeof stream;
  fs: ReturnType<typeof createFSModule>;
  path: ReturnType<typeof createPathModule>;
  os: ReturnType<typeof createOSModule>;
  util: ReturnType<typeof createUtilModule>;
  http: ReturnType<typeof createHTTPModule>;
  https: ReturnType<typeof createHTTPSModule>;
  events: ReturnType<typeof createEventsModule>;
  buffer: typeof buffer;
  readline: ReturnType<typeof createReadlineModule>;
  string_decoder: typeof stringDecoderModule;
  querystring: typeof querystringModule;
  tty: ReturnType<typeof createTTYModule>;
  assert: ReturnType<typeof createAssertModule>;
  module: ReturnType<typeof createModuleModule>;
  net: typeof netModule;
  v8: ReturnType<typeof createV8Module>;
  crypto: ReturnType<typeof createCryptoModule>;
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
    getCwd,
    getEnv,
    runShell,
    filesystem,
    writeStdout,
    writeStderr,
    terminalColumns,
    terminalRows,
  } = options;

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
    util: createUtilModule(),
    http: createHTTPModule(),
    https: createHTTPSModule(),
    events: createEventsModule(),
    buffer,
    readline: createReadlineModule(processStdin, getTrackIO),
    querystring: querystringModule,
    string_decoder: stringDecoderModule,
    tty: createTTYModule(terminalColumns, terminalRows),
    assert: createAssertModule(),
    module: createModuleModule(requireFactory),
    net: netModule,
    url: urlModule,
    stream: stream,
    v8: createV8Module(),
    crypto: createCryptoModule(),
    child_process: createChildProcessModule({
      runShell,
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
        if (
          typeof value.stdout !== 'string' ||
          typeof value.stderr !== 'string' ||
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
