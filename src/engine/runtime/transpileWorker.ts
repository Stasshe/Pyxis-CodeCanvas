/**
 * [NEW ARCHITECTURE] Transpile Worker
 * 
 * ## 役割
 * Web Worker内でBabel standaloneを使用してトランスパイルを実行
 * メインスレッドをブロックせず、完了後にWorkerを即座に終了してメモリを解放
 * 
 * ## 処理フロー
 * 1. Babel standaloneを初期化
 * 2. TypeScript/JSX/ES Moduleをトランスパイル
 * 3. 依存関係を抽出
 * 4. 結果をメインスレッドに返す
 * 5. Worker終了
 */


// @ts-ignore
import initSwc, { transformSync } from '@swc/wasm';

// SWC JSプラグイン: import/export/require/dynamic importをASTで変換
// swc_plugin_js形式
export function swcAsyncModulePlugin() {
  return {
    name: 'swc-async-module',
    visitor: {
      ImportDeclaration(path: any) {
        const { node } = path;
        const source = node.source.value;
        const decls: any[] = [];
        node.specifiers.forEach((spec: any) => {
          if (spec.type === 'ImportDefaultSpecifier') {
            // import foo from 'mod'
            decls.push({
              type: 'VariableDeclarator',
              id: spec.local,
              init: {
                type: 'LogicalExpression',
                operator: '??',
                left: {
                  type: 'MemberExpression',
                  object: {
                    type: 'AwaitExpression',
                    argument: {
                      type: 'CallExpression',
                      callee: { type: 'Identifier', name: '__require__' },
                      arguments: [{ type: 'StringLiteral', value: source }],
                    },
                  },
                  property: { type: 'Identifier', name: 'default' },
                  computed: false,
                },
                right: {
                  type: 'AwaitExpression',
                  argument: {
                    type: 'CallExpression',
                    callee: { type: 'Identifier', name: '__require__' },
                    arguments: [{ type: 'StringLiteral', value: source }],
                  },
                },
              },
            });
          } else if (spec.type === 'ImportSpecifier') {
            // import {foo} from 'mod'
            decls.push({
              type: 'VariableDeclarator',
              id: { type: 'Identifier', name: spec.local.name },
              init: {
                type: 'MemberExpression',
                object: {
                  type: 'AwaitExpression',
                  argument: {
                    type: 'CallExpression',
                    callee: { type: 'Identifier', name: '__require__' },
                    arguments: [{ type: 'StringLiteral', value: source }],
                  },
                },
                property: { type: 'Identifier', name: spec.imported.name },
                computed: false,
              },
            });
          } else if (spec.type === 'ImportNamespaceSpecifier') {
            // import * as ns from 'mod'
            decls.push({
              type: 'VariableDeclarator',
              id: spec.local,
              init: {
                type: 'AwaitExpression',
                argument: {
                  type: 'CallExpression',
                  callee: { type: 'Identifier', name: '__require__' },
                  arguments: [{ type: 'StringLiteral', value: source }],
                },
              },
            });
          }
        });
        if (decls.length > 0) {
          path.replaceWith({
            type: 'VariableDeclaration',
            kind: 'const',
            declarations: decls,
          });
        } else {
          // import 'mod'
          path.replaceWith({
            type: 'ExpressionStatement',
            expression: {
              type: 'AwaitExpression',
              argument: {
                type: 'CallExpression',
                callee: { type: 'Identifier', name: '__require__' },
                arguments: [{ type: 'StringLiteral', value: source }],
              },
            },
          });
        }
        let fn = path.getFunctionParent();
        if (fn) fn.node.async = true;
      },
      CallExpression(path: any) {
        const { node } = path;
        // require('foo') → await __require__('foo')
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1
        ) {
          node.callee.name = '__require__';
          path.replaceWith({
            type: 'AwaitExpression',
            argument: node,
          });
          let fn = path.getFunctionParent();
          if (fn) fn.node.async = true;
        }
        // import('foo') → await __import__('foo')
        if (
          node.callee.type === 'Import' &&
          node.arguments.length === 1
        ) {
          path.replaceWith({
            type: 'AwaitExpression',
            argument: {
              type: 'CallExpression',
              callee: { type: 'Identifier', name: '__import__' },
              arguments: node.arguments,
            },
          });
          let fn = path.getFunctionParent();
          if (fn) fn.node.async = true;
        }
      },
      ExportDefaultDeclaration(path: any) {
        const { node } = path;
        path.replaceWith({
          type: 'ExpressionStatement',
          expression: {
            type: 'AssignmentExpression',
            operator: '=',
            left: {
              type: 'MemberExpression',
              object: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'module' },
                property: { type: 'Identifier', name: 'exports' },
                computed: false,
              },
              property: { type: 'Identifier', name: 'default' },
              computed: false,
            },
            right: node.declaration,
          },
        });
      },
      ExportNamedDeclaration(path: any) {
        const { node } = path;
        if (node.declaration) {
          // export const foo = ...
          if (node.declaration.type === 'VariableDeclaration') {
            const assigns = node.declaration.declarations.map((decl: any) => ({
              type: 'ExpressionStatement',
              expression: {
                type: 'AssignmentExpression',
                operator: '=',
                left: {
                  type: 'MemberExpression',
                  object: {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: 'module' },
                    property: { type: 'Identifier', name: 'exports' },
                    computed: false,
                  },
                  property: { type: 'Identifier', name: decl.id.name },
                  computed: false,
                },
                right: { type: 'Identifier', name: decl.id.name },
              },
            }));
            path.replaceWithMultiple([node.declaration, ...assigns]);
          } else if (node.declaration.type === 'FunctionDeclaration') {
            const name = node.declaration.id.name;
            path.replaceWithMultiple([
              node.declaration,
              {
                type: 'ExpressionStatement',
                expression: {
                  type: 'AssignmentExpression',
                  operator: '=',
                  left: {
                    type: 'MemberExpression',
                    object: {
                      type: 'MemberExpression',
                      object: { type: 'Identifier', name: 'module' },
                      property: { type: 'Identifier', name: 'exports' },
                      computed: false,
                    },
                    property: { type: 'Identifier', name: name },
                    computed: false,
                  },
                  right: { type: 'Identifier', name },
                },
              },
            ]);
          }
        } else if (node.specifiers.length > 0) {
          // export { foo, bar }
          const assigns = node.specifiers.map((spec: any) => ({
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: {
                type: 'MemberExpression',
                object: {
                  type: 'MemberExpression',
                  object: { type: 'Identifier', name: 'module' },
                  property: { type: 'Identifier', name: 'exports' },
                  computed: false,
                },
                property: { type: 'Identifier', name: spec.exported.name },
                computed: false,
              },
              right: { type: 'Identifier', name: spec.local.name },
            },
          }));
          path.replaceWithMultiple(assigns);
        }
      },
    },
  };
}

// IndexedDBキャッシュAPIは親スレッドで管理するため、ここではキャッシュヒット時のバイパスのみ対応

// @swc/wasmはimport時に初期化されるため、追加のinitは不要
async function ensureSwcReady() {
  // noop
}

// NOTE: If you build the Rust SWC plugin to wasm via CI (see .github/workflows/rust-wasm.yml),
// the generated `pkg/` contains a JS glue file and a .wasm. Copy those into your web worker
// bundle and import the generated JS to call `process_plugin` before calling `transformSync`.
// Example (worker):
// import initPlugin, { process_plugin } from './pkg/swc_async_require_plugin.js';
// await initPlugin();
// const transformedAstJson = process_plugin(astJson);


/**
 * Babel Plugin: ES Module と require() を変換
 */


/**
 * トランスパイルリクエスト
 */
export interface TranspileRequest {
  id: string;
  code: string;
  filePath: string;
  options: {
    isTypeScript: boolean;
    isESModule: boolean;
    isJSX: boolean;
  };
}

/**
 * トランスパイル結果
 */
export interface TranspileResult {
  id: string;
  code: string;
  sourceMap?: string;
  dependencies: string[];
  error?: string;
}

/**
 * トランスパイル実行
 */
async function transpile(request: TranspileRequest): Promise<TranspileResult> {
  try {
    await ensureSwcReady();
    const { code, filePath, options } = request;
    const ext = filePath.split('.').pop() || 'js';
    let swcOptions: any = {
      filename: filePath,
      jsc: {
        parser: {
          syntax: options.isTypeScript ? (options.isJSX ? 'typescript' : 'typescript') : (options.isJSX ? 'ecmascript' : 'ecmascript'),
          tsx: options.isJSX || ext === 'tsx',
          jsx: options.isJSX || ext === 'jsx',
          decorators: true,
        },
        transform: {
          react: options.isJSX ? { runtime: 'automatic', development: false } : undefined,
        },
      },
      module: {
        type: options.isESModule ? 'es6' : 'commonjs',
      },
      sourceMaps: false,
      minify: false,
      experimental: {
        plugins: [[swcAsyncModulePlugin]],
      },
    };

    // SWCでトランスパイル（AST変換プラグイン適用）
    let result = transformSync(code, swcOptions);
    let outCode = result.code;

    // 依存関係抽出
    const dependencies = extractDependencies(outCode);

    return {
      id: request.id,
      code: outCode,
      sourceMap: result.map ? JSON.stringify(result.map) : undefined,
      dependencies,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      self.postMessage({ type: 'log', level: 'error', message: `❌ Transpile error: ${errorMessage}` });
    } catch {
      console.error(`postMessage failed, ❌ Transpile error: ${errorMessage}`);
    }
    return {
      id: request.id,
      code: '',
      dependencies: [],
      error: errorMessage,
    };
  }
}

/**
 * 依存関係を抽出
 */
function extractDependencies(code: string): string[] {
  const dependencies = new Set<string>();

  // require('module') パターン
  const requireRegex = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = requireRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  // import 文（トランスパイル後にrequireに変換されているはず）
  // 念のため import from パターンも検出
  const importRegex = /import\s+(?:[\w*{}\s,]+\s+from\s+)?['"]([^'"]+)['"]/g;
  while ((match = importRegex.exec(code)) !== null) {
    dependencies.add(match[1]);
  }

  return Array.from(dependencies);
}

/**
 * メッセージハンドラー
 */

self.addEventListener('message', async (event: MessageEvent<TranspileRequest>) => {
  const request = event.data;
  try {
    const result = await transpile(request);
    self.postMessage(result);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    self.postMessage({
      id: request.id,
      code: '',
      dependencies: [],
      error: errorMessage,
    } as TranspileResult);
  }
  self.close();
});

// Signal ready and log initialization to main thread
try {
  self.postMessage({ type: 'ready' });
  self.postMessage({ type: 'log', level: 'info', message: '✅ Transpile worker initialized with SWC wasm' });
} catch {
  // ignore
}
