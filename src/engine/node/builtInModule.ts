/**
 * [NEW ARCHITECTURE] Built-in Node.js モジュールのエミュレーション（統合エントリーポイント）
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

import { Buffer } from './modules/bufferModule';
import * as stream from 'stream';
import { createFSModule, type FSModuleOptions } from './modules/fsModule';
import { createHTTPModule, createHTTPSModule } from './modules/httpModule';
import { createOSModule } from './modules/osModule';
import { createPathModule } from './modules/pathModule';
import { createReadlineModule } from './modules/readlineModule';
import { createUtilModule } from './modules/utilModule';
import { createAssertModule } from './modules/assertModule';
import { createEventsModule } from './modules/eventsModule';
import { createModuleModule } from './modules/moduleModule';
import * as urlModule from './modules/urlModule';

export interface BuiltInModulesOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
  onInput?: (prompt: string, callback: (input: string) => void) => void;
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
}

/**
 * すべてのビルトインモジュールを作成
 *
 * @param options - プロジェクト情報
 * @returns すべてのビルトインモジュール
 */
export function createBuiltInModules(options: BuiltInModulesOptions): BuiltInModules {
  const { projectDir, projectId, projectName, onInput } = options;

  return {
    fs: createFSModule({ projectDir, projectId, projectName }),
    path: createPathModule(projectDir),
    os: createOSModule(),
    util: createUtilModule(),
    http: createHTTPModule(),
    https: createHTTPSModule(),
    events: createEventsModule(),
    Buffer: Buffer,
    readline: createReadlineModule(onInput),
    assert: createAssertModule(),
    module: createModuleModule(),
    url: urlModule,
    stream: stream,
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
