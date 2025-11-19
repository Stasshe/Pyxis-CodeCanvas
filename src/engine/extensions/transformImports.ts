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
  // Replace only the first React import occurrence to avoid mangling
  // large bundled code where naive regex may accidentally match unintended parts.
  let replaced = false;
  return code.replace(
    /import\s+React\s*,\s*\{([^}]+)\}\s+from\s+['"]react['"];?|import\s+React\s+from\s+['"]react['"];?|import\s+\{([^}]+)\}\s+from\s+['"]react['"];?/g,
    (match, namedImportsWithDefault, namedImportsOnly) => {
      if (replaced) return match; // leave subsequent imports untouched
      replaced = true;

      if (namedImportsWithDefault) {
        // namedImportsWithDefault contains the named part inside `{ ... }` when default is present
        const named = namedImportsWithDefault.trim();
        const mapped = named
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((token: string) => {
            // handle `a as b` -> `a: b`
            const m = token.match(/^(.+?)\s+as\s+(.+)$/);
            if (m) return `${m[1].trim()}: ${m[2].trim()}`;
            return token;
          })
          .join(', ');
        return `const React = window.__PYXIS_REACT__; const { ${mapped} } = React;`;
      }
      if (namedImportsOnly) {
        const named = namedImportsOnly.trim();
        const mapped = named
          .split(',')
          .map((s: string) => s.trim())
          .filter(Boolean)
          .map((token: string) => {
            const m = token.match(/^(.+?)\s+as\s+(.+)$/);
            if (m) return `${m[1].trim()}: ${m[2].trim()}`;
            return token;
          })
          .join(', ');
        return `const { ${mapped} } = window.__PYXIS_REACT__;`;
      }
      return 'const React = window.__PYXIS_REACT__;';
    }
  );
}
