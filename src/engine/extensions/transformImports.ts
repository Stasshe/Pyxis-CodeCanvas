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
  // named imports内の`as`をオブジェクト分割代入の形式(:)に変換して対応する
  function convertNamedImportsForDestructure(named: string): string {
    return named.replace(
      /([A-Za-z0-9_$]+)\s+as\s+([A-Za-z0-9_$]+)/g,
      (_m, orig, alias) => `${orig}: ${alias}`
    );
  }
  // Support resolving several host-provided modules (react + markdown/math libs)
  const modules = [
    'react',
    'react-markdown',
    'remark-gfm',
    'remark-math',
    'rehype-katex',
    'rehype-raw',
    'katex',
  ];

  const modPattern = modules.map(m => m.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')).join('|');

  // single-pass regex handling default+named, namespace (import * as), named-only, default-only imports
  const regex = new RegExp(
    `import\\s+([A-Za-z0-9_$]+)\\s*,\\s*\\{([^}]+)\\}\\s+from\\s+['"](${modPattern})['"];?|` +
      `import\\s*\\*\\s+as\\s+([A-Za-z0-9_$]+)\\s+from\\s+['"](${modPattern})['"];?|` +
      `import\\s+\\{([^}]+)\\}\\s+from\\s+['"](${modPattern})['"];?|` +
      `import\\s+([A-Za-z0-9_$]+)\\s+from\\s+['"](${modPattern})['"];?`,
    'g'
  );

  function moduleToHost(moduleName: string) {
    if (moduleName === 'react') return { global: 'window.__PYXIS_REACT__', prop: null };
    // map hyphenated module names to expected properties on window.__PYXIS_MARKDOWN__
    const map: Record<string, string> = {
      'react-markdown': 'ReactMarkdown',
      'remark-gfm': 'remarkGfm',
      'remark-math': 'remarkMath',
      'rehype-katex': 'rehypeKatex',
      'rehype-raw': 'rehypeRaw',
      katex: 'katex',
    };
    return { global: 'window.__PYXIS_MARKDOWN__', prop: map[moduleName] || null };
  }

  return code.replace(
    regex,
    (
      match,
      defWithName,
      namedWithDef,
      mod1,
      namespaceName,
      mod2,
      namedOnly,
      mod3,
      defOnly,
      mod4
    ) => {
      // Cases:
      // 1) defWithName, namedWithDef, mod1  => import defWithName, { namedWithDef } from 'mod1'
      // 2) namedOnly, mod2                  => import { namedOnly } from 'mod2'
      // 3) defOnly, mod3                    => import defOnly from 'mod3'

      let moduleName: string | null = null;
      if (mod1) moduleName = mod1;
      else if (mod2) moduleName = mod2;
      else if (mod3) moduleName = mod3;
      else if (mod4) moduleName = mod4;
      if (!moduleName) return match;

      const host = moduleToHost(moduleName);

      // helper to process named imports
      const processNamed = (s: string) => {
        const trimmed = s.trim();
        const processed = convertNamedImportsForDestructure(trimmed);
        return processed;
      };

      // import default, { named } from 'module'
      if (defWithName && namedWithDef && moduleName) {
        const defName = defWithName;
        const namedProcessed = processNamed(namedWithDef);

        if (moduleName === 'react') {
          return `const ${defName} = ${host.global}; const {${namedProcessed}} = ${defName};`;
        }

        // host-provided markdown/math
        const prop = host.prop ? `.${host.prop}` : '';
        return `const ${defName} = ${host.global}${prop} || ${host.global}; const {${namedProcessed}} = ${host.global};`;
      }

      // import { named } from 'module'
      if (namedOnly && moduleName) {
        const namedProcessed = processNamed(namedOnly);
        if (moduleName === 'react') {
          return `const {${namedProcessed}} = ${host.global};`;
        }
        return `const {${namedProcessed}} = ${host.global} || {};`;
      }

      // import default from 'module'
      if (defOnly && moduleName) {
        const defName = defOnly;
        if (moduleName === 'react') {
          return `const ${defName} = ${host.global};`;
        }
        const prop = host.prop ? `.${host.prop}` : '';
        return `const ${defName} = ${host.global}${prop} || ${host.global};`;
      }

      // import * as ns from 'module'
      if (namespaceName && moduleName) {
        const ns = namespaceName;
        if (moduleName === 'react') {
          return `const ${ns} = ${host.global};`;
        }
        // For markdown/math, expose the host markdown namespace or an empty object
        return `const ${ns} = ${host.global} || {};`;
      }

      return match;
    }
  );
}
