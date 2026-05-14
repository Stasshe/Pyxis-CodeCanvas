/**
 * Built-in Node.js モジュールのエミュレーション（統合エントリーポイント）
 *
 * ## 主な変更点
 * - fileRepositoryを直接使用してIndexedDBに保存
 * - GitFileSystemへの同期は自動的に実行される
 * - プロジェクト情報（projectId, projectName）を必須パラメータとして追加
 * - 後方互換性は無視（破壊的変更）
 *
 * ## 使用方法
 * ```typescript
 * import { createBuiltInModules } from '@/engine/node/builtInModule_new';
 *
 * const modules = createBuiltInModules({
 *   projectDir: '/projects/my-project',
 *   projectId: 'project-123',
 *   projectName: 'my-project',
 * });
 *
 * // fsモジュールを使用
 * await modules.fs.writeFile('/test.txt', 'Hello World');
 *
 * // httpモジュールを使用
 * modules.http.get('http://example.com', (res) => {
 *   res.on('data', (chunk) => console.log(chunk));
 * });
 * ```
 */

import * as stream from 'node:stream';
import { createAssertModule } from './modules/assertModule';
import { Buffer } from './modules/bufferModule';
import { createEventsModule } from './modules/eventsModule';
import { type FSModuleOptions, createFSModule } from './modules/fsModule';
import { createHTTPModule, createHTTPSModule } from './modules/httpModule';
import { createModuleModule } from './modules/moduleModule';
import { createOSModule } from './modules/osModule';
import { createPathModule } from './modules/pathModule';
import { createReadlineModule } from './modules/readlineModule';
import type { ProcessStdin } from '@/engine/cmd/terminalProcessBridge';
import * as urlModule from './modules/urlModule';
import { createUtilModule } from './modules/utilModule';
import { createV8Module } from './modules/v8Module';
import { createCryptoModule } from './modules/cryptoModule';
import type { MountRouter } from '@/engine/runtime/storage/MountRouter';

export interface BuiltInModulesOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
  processStdin?: ProcessStdin;
  getTrackIO?: () => ((p: Promise<void>) => void) | undefined;
  requireFactory?: (filename: string) => (id: string) => unknown;
  getCwd?: () => string;
  mountRouter: MountRouter;
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
  Buffer: typeof Buffer;
  readline: ReturnType<typeof createReadlineModule>;
  assert: any;
  module: ReturnType<typeof createModuleModule>;
  v8: ReturnType<typeof createV8Module>;
  crypto: ReturnType<typeof createCryptoModule>;
}

/**
 * すべてのビルトインモジュールを作成
 *
 * @param options - プロジェクト情報
 * @returns すべてのビルトインモジュール
 */
export function createBuiltInModules(options: BuiltInModulesOptions): BuiltInModules {
  const {
    projectDir,
    projectId,
    projectName,
    processStdin,
    getTrackIO,
    requireFactory,
    getCwd,
    mountRouter,
  } = options;

  return {
    fs: createFSModule({ projectDir, projectId, projectName, mountRouter, getTrackIO }),
    path: createPathModule(getCwd ?? (() => projectDir)),
    os: createOSModule(),
    util: createUtilModule(),
    http: createHTTPModule(),
    https: createHTTPSModule(),
    events: createEventsModule(),
    Buffer: Buffer,
    readline: createReadlineModule(processStdin, getTrackIO),
    assert: createAssertModule(),
    module: createModuleModule(requireFactory),
    url: urlModule,
    stream: stream,
    v8: createV8Module(),
    crypto: createCryptoModule(),
  };
}

/**
 * 個別のモジュールを作成（必要に応じて使用）
 */
export {
  createFSModule,
  createPathModule,
  createOSModule,
  createUtilModule,
  createHTTPModule,
  createHTTPSModule,
  createEventsModule,
  Buffer,
  createReadlineModule,
  createAssertModule,
  createModuleModule,
  urlModule,
  stream,
};

/**
 * 型定義のエクスポート
 */
export type { FSModuleOptions };
