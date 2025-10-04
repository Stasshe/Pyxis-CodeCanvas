/**
 * Babel Plugin: require() を await __require__() に変換
 * 
 * ## 目的
 * CommonJSの同期的なrequire()を非同期のawait __require__()に変換し、
 * IndexedDBからモジュールを読み込めるようにする
 * 
 * ## 変換例
 * ```js
 * // 変換前
 * const lodash = require('lodash');
 * const merge = require('lodash/merge');
 * 
 * // 変換後
 * const lodash = await __require__('lodash');
 * const merge = await __require__('lodash/merge');
 * ```
 */

export function babelPluginAsyncRequire() {
  return {
    name: 'async-require',
    visitor: {
      // require() 呼び出しを検出
      CallExpression(path: any) {
        const { node } = path;
        
        // require('module') パターン
        if (
          node.callee.type === 'Identifier' &&
          node.callee.name === 'require' &&
          node.arguments.length === 1
        ) {
          // require を __require__ に変更
          node.callee.name = '__require__';
          
          // await を追加
          const awaitExpression = {
            type: 'AwaitExpression',
            argument: node,
          };
          
          path.replaceWith(awaitExpression);
          
          // 親がasync関数でない場合、async にする
          let functionParent = path.getFunctionParent();
          if (functionParent) {
            functionParent.node.async = true;
          }
        }
      },
    },
  };
}
