# Markdown Preview の AMD 衝突 (2026-10-08)

## 症状

Stassheから「md previewしたときこうなる」と報告があった。README の Open Preview は調査中に使った再現手順である。

```text
loader.js:965 Uncaught Error: Can only have one anonymous define call per script file
```

React の汎用コンポーネントエラーと `QuickOpenHistory` のログも同時に見えたが、前者は例外後のツリー破棄時に出た結果で、後者は同時刻の記録であり原因ではない。

## 原因と再現

agent-browser で先に Monaco Editor を読み込み、`globalThis.define.amd === true` の状態で README タブを右クリックして Open Preview を実行すると再現する。Markdown の Mermaid chunk が `fastdom` と `fastdom-promised` の UMD を読み、それぞれの匿名 AMD `define` が Monaco のグローバル AMD loader に届く。保存された console stack は最適化 chunk の line 276 を通り、2つ目の登録を Monaco が `loader.js:965` で拒否したことを示す。例外で React のプレビュー tree が破棄される。

Eruda と filesystem/storage は原因ではない。

## 修正

[Vite設定](../../../vite.config.ts)で自由変数 `define` を `undefined` に置き換える。これは production build の `define` と dev dependency optimizer の `optimizeDeps.rolldownOptions.transform.define` の両方に設定する。Monaco が使う `window.define` は維持し、Vite が bundle する UMD dependency の AMD 分岐だけを無効化する。

別件として、math delimiter 前処理が tilde fence と長い backtick fence 内の `\(...\)` / `\[...\]` をドル数式へ変換していた。inline code と正しい fence 長を保護する前処理に置き換え、6件の回帰テストを追加した。関連実装: [markdownMath.ts](../../../src/components/Tab/markdownMath.ts)、[テスト](../../../tests/components/markdownMath.test.ts)。設計境界は[データフロー](../../DATA-FLOW.md)を参照。

## 検証

- 開発版の Markdown fixture を desktop 1280×900 と mobile 390×844 で確認。相対/絶対 OPFS PNG、外部画像、dollar/bracket/both math、inline・backtick/tilde/長い fence 内のコード、dagre/ELK/Gantt、zoom/reset、正規化した相対 Markdown link、HTML iframe、画像 tab、GFM table/task list、raw `<details>`、reload 復元が動作した。
- Production preview では Monaco AMD が有効な状態で README を開き、preview からの AMD 登録が0件、例外なしを確認。syntax highlighting と clipboard copy も動作した。
- Biome format/lint は394ファイル、TypeScript check と build は成功 (30 extensions、25 TypeScript checks)。math 回帰テストは6/6成功。
- 全 Vitest は89 files / 679 tests: 619成功、60失敗、pendingなし。失敗は既存の shell suites のみ: environment expansion 22、error handling 8、pipeline 10、subshell 20。
- Browser session と production preview server は終了。Stassheの既存 dev server port 5173 は稼働を維持した。

全体の検証記録は[Development/TODO.md](../../../Development/TODO.md)にある。
