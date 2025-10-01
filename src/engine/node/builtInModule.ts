/**
 * [NEW ARCHITECTURE] Built-in Node.js モジュールのエミュレーション（統合エントリーポイント）
 *
 * ## 主な変更点
 * - onFileOperationコールバックを完全に削除
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

import { createFSModule, type FSModuleOptions } from './modules/fsModule';
import { createPathModule } from './modules/pathModule';
import { createOSModule } from './modules/osModule';
import { createUtilModule } from './modules/utilModule';
import { createHTTPModule, createHTTPSModule } from './modules/httpModule';
import { Buffer } from './modules/bufferModule';
import { createReadlineModule } from './modules/readlineModule';

export interface BuiltInModulesOptions {
  projectDir: string;
  projectId: string;
  projectName: string;
}

export interface BuiltInModules {
  fs: ReturnType<typeof createFSModule>;
  path: ReturnType<typeof createPathModule>;
  os: ReturnType<typeof createOSModule>;
  util: ReturnType<typeof createUtilModule>;
  http: ReturnType<typeof createHTTPModule>;
  https: ReturnType<typeof createHTTPSModule>;
  Buffer: typeof Buffer;
  readline: ReturnType<typeof createReadlineModule>;
}

/**
 * すべてのビルトインモジュールを作成
 *
 * @param options - プロジェクト情報
 * @returns すべてのビルトインモジュール
 */
export function createBuiltInModules(options: BuiltInModulesOptions): BuiltInModules {
  const { projectDir, projectId, projectName } = options;

  return {
    fs: createFSModule({ projectDir, projectId, projectName }),
    path: createPathModule(projectDir),
    os: createOSModule(),
    util: createUtilModule(),
    http: createHTTPModule(),
    https: createHTTPSModule(),
    Buffer: Buffer,
    readline: createReadlineModule(),
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
  Buffer,
  createReadlineModule,
};

/**
 * 型定義のエクスポート
 */
export type { FSModuleOptions };
