/**
 * import文を書き換えてグローバル変数から取得するように変換
 *
 * Note: 文字列置換は推奨される方法ではないが、static siteの制約上、
 * ブラウザでdynamic importする際にReactを解決する最も現実的な方法。
 * Import Mapsは既存のバンドルと競合する可能性があるため採用していない。
 *
 * 実装の制約:
 * - コメント・文字列内のimportも変換される (tscトランスパイル後なので実害なし)
 * - スペースは保持される (JavaScriptとして有効なので問題なし)
 * - import * as React from 'react' の形式には対応していない (現状使用されていないため)
 *
 * 正規表現の順序を最適化し、一度のパスで全パターンを処理することで
 * 既に変換されたコードに対する誤った再変換を防止する。
 */
export function transformImports(code: string): string {
  // すべてのReact importパターンを単一の正規表現で処理
  // 改行を含むimportにも対応するため[\s\S]を使用
  return code.replace(
    /import\s+React\s*,\s*\{([^}]+)\}\s+from\s+['"]react['"];?|import\s+React\s+from\s+['"]react['"];?|import\s+\{([^}]+)\}\s+from\s+['"]react['"];?/g,
    (match, namedImportsWithDefault, namedImportsOnly) => {
      // import React, { ... } from 'react'
      if (namedImportsWithDefault) {
        return `const React = window.__PYXIS_REACT__; const {${namedImportsWithDefault}} = React;`;
      }
      // import { ... } from 'react' (Reactのdefaultなし)
      if (namedImportsOnly) {
        return `const {${namedImportsOnly}} = window.__PYXIS_REACT__;`;
      }
      // import React from 'react'
      return 'const React = window.__PYXIS_REACT__;';
    }
  );
}
