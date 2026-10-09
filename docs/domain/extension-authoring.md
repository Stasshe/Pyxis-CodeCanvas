# 拡張機能の作り方

仕組みは [extensions](extensions.md)。

## 手順

1. `pnpm run create-extension`で雛形を作る。対話でtype（ui・tool・transpiler・service・builtin-module）、uiならsidebar・tab・両方、npm libraryの有無を選ぶ。IDは`^[a-z0-9-]+$`で、manifestのIDは`pyxis.<id>`になる。生成先は`extensions/<id>/`。
2. `index.ts(x)`に`activate`を書く。型は`extensions/_shared/types.ts`と`systemModuleTypes.ts`からimportし、`src/`はimportしない。
3. `pnpm run dev`（または`pnpm run setup-build`）でbuildとregistry生成が走る。registryへの手動登録は不要。
4. アプリのExtensions panelからinstallして有効化する。

directory名はIDから`pyxis.`を除いたものと一致させる。loaderはIDから配信pathを組み立てる。

## manifest

| field | 内容 |
|---|---|
| `id`、`name`、`version`、`type`、`description`、`author`、`entry`、`metadata` | 必須。`entry`は通常`index.js` |
| `defaultEnabled` | 初回起動時に自動installするか |
| `dependencies` | 依存拡張ID。警告だけで自動installしない |
| `onlyOne` | 排他group。同groupは同時に1つだけ有効 |
| `files` | buildが自動で書く。手書き不要 |
| `icon`、`homepage`、`packGroup` | 任意 |

## entry

```ts
import type { ExtensionActivation, ExtensionContext } from '../_shared/types';

export async function activate(context: ExtensionContext): Promise<ExtensionActivation> {
  context.commands.registerCommand('hello', async args => `Hello, ${args.join(' ') || 'World'}!`);
  return {};
}

export async function deactivate(): Promise<void> {}
```

- `deactivate`ではtimerや自前の購読を止める。コマンド・タブ・panel・menuはホストが解除する。
- 拡張タブは`context.tabs.registerTabType(Component)`の後に`createTab()`で開く。
- workspaceのfileは`getSystemModule('fsClient')`で絶対pathを使って読み書きする。rootは`getSystemModule('workspace')`。command handlerの`context.fsClient`はcoreの`FsApi`、system moduleは変更listenerを含む拡張向けFS APIを提供する。
- コマンド名は全拡張で共有の名前空間なので、組み込みや他拡張と衝突しない名前にする。

## 複数fileとnpm library

| 方式 | 条件 | 注意 |
|---|---|---|
| tsc | `package.json`なし | sourceごとにJSが出る。entryと追加fileの相対side-effect/static/re-export/文字列literal dynamic importをBlob URLへ解決する。nested importもimport元file基準で解決される。拡張子なしは`.js`・`.mjs`・`.ts`・`.tsx`、次にdirectoryの`index`を探す。bare specifierと式を使うdynamic importはloaderで変換されない。循環する相対import、JS escape sequenceを含むspecifierは使えない。型errorはbuild全体を止める |
| esbuild | `package.json`あり、`pnpm add`でlibraryを入れる | 1 fileにbundleされるので相対importの制約はない。React・react-dom・Markdown系（react-markdown、remark-gfm、remark-math、rehype-katex、rehype-raw、katex）はexternalでhostのものを使う。型検査はしない |

追加のbuild処理が必要なら`_build.js`を置く。`node _build.js <distDir>`で呼ばれる。

## 言語pack

IDは`pyxis.lang.<locale>`、`onlyOne: "lang-pack"`。`activate`は`services['language-pack']`に`{locale, name, nativeName}`を返すだけで、翻訳本体は`locales/`から読まれる（[i18n](i18n.md)）。

## 実例

`extensions/sample-command/`（コマンド）、`note-tab/`（タブ）、`todo-panel/`（sidebar）、`test-multi-file/`（tscの複数file）、`chart-extension/`（esbuildとnpm library）、`binary-editor/`（explorer menuとタブ）、`typescript-runtime/`（transpiler）、`lang-packs/ja/`。
