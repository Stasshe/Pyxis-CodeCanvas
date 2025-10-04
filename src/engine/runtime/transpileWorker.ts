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

import * as Babel from '@babel/standalone';

/**
 * Babel Plugin: ES Module と require() を変換
 */
function babelPluginModuleTransform() {
  return {
    name: 'module-transform',
    visitor: {
      // import文を await __require__() に変換
      ImportDeclaration(path: any) {
        const { node } = path;
        const source = node.source.value;
        
        // import defaultExport from 'module'
        // import { named } from 'module'
        // import * as namespace from 'module'
        
        const declarations: any[] = [];
        
        node.specifiers.forEach((spec: any) => {
          if (spec.type === 'ImportDefaultSpecifier') {
            // const defaultExport = (await __require__('module')).default || await __require__('module')
            declarations.push({
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
          } else if (spec.type === 'ImportSpecifier') {
            // const { named } = await __require__('module')
            declarations.push({
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
            // const namespace = await __require__('module')
            declarations.push({
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
        
        if (declarations.length > 0) {
          const variableDeclaration = {
            type: 'VariableDeclaration',
            kind: 'const',
            declarations,
          };
          path.replaceWith(variableDeclaration);
        } else {
          // import 'module' (side effect only)
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
        
        // 親関数をasyncに
        let functionParent = path.getFunctionParent();
        if (functionParent) {
          functionParent.node.async = true;
        }
      },
      
      // export文を module.exports に変換
      ExportDefaultDeclaration(path: any) {
        const { node } = path;
        path.replaceWith({
          type: 'ExpressionStatement',
          expression: {
            type: 'AssignmentExpression',
            operator: '=',
            left: {
              type: 'MemberExpression',
              object: { type: 'Identifier', name: 'module' },
              property: { type: 'Identifier', name: 'exports' },
              computed: false,
            },
            right: node.declaration,
          },
        });
      },
      
      ExportNamedDeclaration(path: any) {
        const { node } = path;
        
        if (node.declaration) {
          // export const foo = 1; => const foo = 1; exports.foo = foo;
          const declarations: any[] = [];
          
          if (node.declaration.type === 'VariableDeclaration') {
            node.declaration.declarations.forEach((decl: any) => {
              declarations.push({
                type: 'ExpressionStatement',
                expression: {
                  type: 'AssignmentExpression',
                  operator: '=',
                  left: {
                    type: 'MemberExpression',
                    object: { type: 'Identifier', name: 'exports' },
                    property: { type: 'Identifier', name: decl.id.name },
                    computed: false,
                  },
                  right: { type: 'Identifier', name: decl.id.name },
                },
              });
            });
          }
          
          path.replaceWithMultiple([node.declaration, ...declarations]);
        } else if (node.specifiers.length > 0) {
          // export { foo, bar };
          const assignments = node.specifiers.map((spec: any) => ({
            type: 'ExpressionStatement',
            expression: {
              type: 'AssignmentExpression',
              operator: '=',
              left: {
                type: 'MemberExpression',
                object: { type: 'Identifier', name: 'exports' },
                property: { type: 'Identifier', name: spec.exported.name },
                computed: false,
              },
              right: { type: 'Identifier', name: spec.local.name },
            },
          }));
          path.replaceWithMultiple(assignments);
        }
      },
      
      // require() を await __require__() に変換
      CallExpression(path: any) {
        const { node } = path;
        
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1
        ) {
          node.callee.name = '__require__';
          
          const awaitExpression = {
            type: 'AwaitExpression',
            argument: node,
          };
          
          path.replaceWith(awaitExpression);
          
          let functionParent = path.getFunctionParent();
          if (functionParent) {
            functionParent.node.async = true;
          }
        }
      },
    },
  };
}

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
function transpile(request: TranspileRequest): TranspileResult {
  try {
    const { code, filePath, options } = request;
    
    // ファイル拡張子を判定
    const ext = filePath.split('.').pop() || 'js';
    
    // Babelプリセットとプラグインを構築
    const presets: [string, any][] = [];
    const plugins: any[] = [];

    // TypeScriptサポート
    if (options.isTypeScript) {
      presets.push([
        'typescript',
        {
          isTSX: options.isJSX || ext === 'tsx',
          allExtensions: true,
        },
      ]);
    }

    // Reactサポート
    if (options.isJSX || ext === 'jsx' || ext === 'tsx') {
      presets.push([
        'react',
        {
          runtime: 'automatic',
          development: false,
        },
      ]);
    }

    // ES Module と require() を変換するプラグインを追加
    plugins.push(babelPluginModuleTransform());

    // トランスパイル実行
    const result = Babel.transform(code, {
      filename: filePath,
      presets,
      plugins,
      sourceMaps: false, // 将来的にtrue
      sourceType: options.isESModule ? 'module' : 'script',
      compact: false,
      retainLines: true,
    });

    if (!result.code) {
      throw new Error('Babel transform returned empty code');
    }

    // 依存関係を抽出
    const dependencies = extractDependencies(result.code);

    return {
      id: request.id,
      code: result.code,
      sourceMap: result.map ? JSON.stringify(result.map) : undefined,
      dependencies,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('❌ Transpile error:', errorMessage);
    
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
self.addEventListener('message', (event: MessageEvent<TranspileRequest>) => {
  const request = event.data;
  
  try {
    const result = transpile(request);
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
  
  // Worker終了（メモリ解放）
  self.close();
});

console.log('✅ Transpile worker initialized with Babel standalone');
