<div align="center">
  <img src="readme-assets/IMG_0033.png" alt="Pyxis Cover" width="100%" />
  
  # Pyxis - Client Side Code Editor

  ## [English Version README](README_en.md)
  
  ### *Zero Setup. Quick Start, Easy Coding*

  [![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://github.com/your-username/pyxis)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Web%20%7C%20iPad%20%7C%20Mobile-orange.svg)](README.md)
  [![Languages](https://img.shields.io/badge/languages-20-blue.svg)](#)
  [![Tauri](https://img.shields.io/badge/Tauri-Desktop-blueviolet?logo=tauri)](https://tauri.app/)
  [![Vite](https://img.shields.io/badge/Vite-8-646cff?logo=vite)](https://vite.dev/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.1-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-v5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
  [![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
  [![Last Commit](https://img.shields.io/github/last-commit/Stasshe/Pyxis-Client-Side-Code-Editor?logo=github)](https://github.com/Stasshe/Pyxis-Client-Side-Code-Editor/commits/main)
  [![Bundle Size](https://img.shields.io/badge/bundle--size-1.04MB-purple?logo=vite)](#)
  
  **[🚀 Pyxis を今すぐ試す](https://Stasshe.github.io/Pyxis-CodeCanvas)**
</div>

---

## Pyxis って何？

- **Pyxisは、iPad向けに設計された1秒で起動する高機動なブラウザIDEです。**
- **静的サイトなので、サーバー起動が必要なく、また課金も一切発生しません。**

### 🌍 **世界20ヶ国語対応 - グローバルなコーディング体験**

**Pyxisはあなたの言語で動作します。** 

> 日本語 • English • 中文 • 繁體中文 • 한국어 • Español • Français • Deutsch • Italiano • Português • Русский • Nederlands • Türkçe • العربية • हिन्दी • ไทย • Tiếng Việt • Bahasa Indonesia • Svenska • Polski

世界中の開発者が母国語でPyxisを快適に利用できます。

### こんな人のために作りました

<div align="center">

| **iPadユーザー** | **PC所有者** |
|:---:|:---:|
| iPadで本格的にコーディング | VSCodeを開くほどではない |
| Stackblitzは重すぎる | ちょっとしたコード編集 |
| タッチ操作に最適化されたIDE | 長めのメモを取りたい |
| 軽快な動作が欲しい | 気軽にサッと使いたい |

</div>


### StackblitzやWebContainerとの違い・Pyxisの設計思想

StackblitzやWebContainerはWeb開発に特化した高度なIDEですが、Pyxisは**「VSCodeのようなエディタ・便利なファイルシステム・実行環境をWeb/iPadで実現する」**ことを目的としています。

- **Stackblitzとの違い**: PyxisはWeb開発専用ではなく、ドキュメント作成やメモ、アルゴリズム学習など幅広い用途を想定。目的自体が異なります。
- **WebContainerとの違い**: Pyxisは常駐Workerを最小限に抑え、OPFSを唯一のファイル保存先として使う独自ランタイムを採用しています。
- **エディタ体験重視**: VSCodeのような操作性・ファイルシステム・実行体験を重視し、iPadやモバイルでも快適に動作。

> 💡 **パソコンのような操作性とiPadの機動性を両立！**
> 🖥️ **Tauriデスクトップ版もサポート！** Windows/Mac/LinuxでネイティブアプリとしてPyxisを利用できます。

---

## Pyxisの革新的機能

### **Markdown・Mermaid・LaTeX - 高品質ドキュメント作成**
<div align="center">
  <img src="readme-assets/IMG_1470.png" alt="リッチコンテンツ編集" width="80%" />
</div>

**Pyxisはマークダウンビューワーに特にこだわっています。**
- **ドキュメント作成** - 技術文書、仕様書を美しく
- **ブログ記事執筆** - リアルタイムプレビューで効率的に
- **Mermaid対応** - フローチャート、図表を簡単作成。PCでは`Alt`または`Ctrl`を押しながらドラッグで移動、ホイールでズーム。タッチ端末ではドラッグ・ピンチ操作に対応
- **LaTeX数式** - 数学的な表現も完璧にレンダリング

Mermaidコードブロックの先頭にYAML frontmatterを書くと、`elk`または`dagre`を選べます。

````markdown
```mermaid
---
config:
  layout: elk
---
flowchart TD
  A --> B
```
````

タイプするだけで即座にプレビュー更新！長文の執筆にも最適です。

---


### **ライブリロード（即時反映） - 簡易サイト構築**
<div align="center">
  <img src="readme-assets/IMG_0034.png" alt="Liveリロードの動作画面" width="80%" />
</div>

**HTML/CSS/JSのみ対応** - ブラウザでしかテストできないが、環境整備は面倒。そんな時に、とても便利。
- HTMLと参照中のCSS・JS・画像の保存をプレビューへ反映（Liveリロード）
- 簡易的なWeb開発に最適
- セットアップ不要でサッと使える

 > **注意**: 現在はHTML/CSS/JSのみ対応。WebContainer等は不要で、自前実装による高速な即時リロードを実現しています。

---


### **Gitバージョン管理・GitHub連携**

**主要なGit機能をブラウザ上で実現。** ブランチ、マージ、コミット、リセット、.git込みエクスポートなどに加え、**GitHubへのpush（PAT認証）にも対応**しています。

clone・fetch・pullは公開repositoryのみ対応します。公開CORS proxyへ認証情報を渡さないため、認証付きclone・fetchは未対応です。詳細は[GitとGitHub](docs/domain/git.md)を参照してください。
TerminalのGit操作は現在directoryから最寄りのrepositoryを探します。`git init`とclone先の相対pathも現在directoryが基準です。`git pull --rebase`は未対応として通信前にエラーを返します。
- **ビジュアル差分** - コード変更を美しく可視化
- **ブランチ操作** - 安全に実験、いつでも戻せる
- **.git込みでダウンロード** - 設定から.gitを含めて丸ごとエクスポート可能
- **GitHubリモート連携** - PAT認証によるpushと、公開repositoryのpullに対応
- **安全な学習環境** - 何を壊しても大丈夫！初心者のGit練習にも最適

> **注意**: pushにはPersonal Access Token（PAT）を使用します。clone・fetch・pullは公開repositoryが対象です。

---

### **AIアシスタント - 流行りのAI IDE**
<div align="center">
  <img src="readme-assets/IMG_0035.png" alt="AIアシスタントによるgit diff採用画面" width="80%" />
</div>
PyxisではAIアシスタントがコード差分の提案・採用をサポート。より直感的なDiff操作・レビュー体験が可能です。
レビューtabでの適用・巻き戻しはチャット側の状態にも反映します。巻き戻しは既存fileを復元し、AIが作成したfileを削除します。適用後に編集されたfileがあれば、その内容を守るため巻き戻しを中止します。

---


### **Node.js & TypeScript ランタイム
<div align="center">
  <img src="readme-assets/IMG_1469.png" alt="Node.js 実行画面" width="80%" />
</div>

Node.jsコードはRuntime Workerで動き、起動済みの待機Workerを再利用します。sloppy scriptのglobal代入と裸の識別子参照をNodeと同じにするため、program globalはWorkerの実際のglobal objectへ置きます。runtime所有の一時descriptorは実行終了時に復元します。正常終了時は実行状態を破棄して待機Workerへ戻し、停止や異常終了時はWorkerを破棄します。Runtime WorkerはOPFSを直接操作せず、FS Workerを通じて必要なfileを読みます。FS Workerは直近の成功path lookupのdirectory handle chainを保持して共通ancestorを再利用しますが、file handleやfile内容はcacheしません。変換済みmoduleの永続cacheはFS Workerが所有し、CommonJS moduleは各実行内で一度だけロードします。`require.resolve(..., { paths })`でpackageの検索rootを指定できます。Nodeの`path`はPOSIXを既定にし、`path.win32`と`path/win32`でWindows pathも扱えます。JavaScript・TypeScriptのmodule解決はNodeのpackage type、`exports` / `imports`条件、拡張子に沿って行います。symlinkはFS WorkerがOPFS上のreserved recordで表し、module cacheとNode metadataはrealpathを基準にします。npmの`.bin`はsymlinkとして作られ、Terminalと`npx`から解決できます。Terminalでは`node -e` / `node --eval`でCommonJS inline scriptを実行できます。`node:constants`はfsと共有する定数を公開し、`node:zlib`はgzip/deflate系の同期・callback APIとstream変換を提供します。`node:string_decoder`にはNode-maintained実装を使い、`node:querystring`はNode互換のparse/stringifyを提供し、`node:diagnostics_channel`は汎用channelと同期・Promise・callback tracing、`node:stream/promises`は`finished`と`pipeline`、`node:stream/web`はnative WHATWG streamとtext/compression APIを提供します。`stream.Readable.fromWeb()` / `toWeb()`はNodeとWHATWGのReadable streamを相互変換します。`process.arch`は`os.arch()`と同じ値を返します。詳細は[Node.js Runtime](docs/domain/node-runtime.md)を参照してください。
`assert`はcallableで`assert/strict`も使えます。`util`はNode由来の`inspect`・`format`・`formatWithOptions`、`isDeepStrictEqual`、`promisify.custom`に対応します。runtimeの`process.env`は実行元shellの環境を引き継ぎ、`process.chdir()`は仮想filesystem内で動きます。`crypto`はhash・HMAC・PBKDF2・random bytes/integers、IV付きcipher、sign/verify、ECDH/DH、公開鍵/秘密鍵encrypt/decrypt、`scrypt`/`scryptSync`を提供します。key generationは未対応です。legacy `url` moduleは`fileURLToPath`と`pathToFileURL`を提供します。
Express 5.2.1とKoa 2.16.4のroute/responseはin-memory HTTP request/responseで確認済みです。Axiosのfetch adapterも動作します。`http.createServer`、socket、AxiosのNode TLS adapterは提供しません。
仮想HOMEは`/home/pyxis`、新規workspaceは空の`~/<name>`、runtime cacheは`~/.cache/pyxis`、npm cacheは`~/.npm`です。folder選択前のeditor paneは空で、file treeはmetadataのみを保持し、fileを開いた時に内容を読み込みます。OperationWindowはQuick Open、Open Folder、Open Recentを独立modeとして提供します。npmはinstall中に依存metadataを共有し、npm registryのabbreviated packumentを`~/.npm/registry`へ保存します。HTTP freshnessに従い、期限切れmetadataはETagで再検証します。tarball archiveはURLのSHA-256で識別し、registryまたはlockfileにintegrity値があれば展開前に検証します。tarball cacheは展開成功後に`~/.npm`へ保存します。`initial_files/`の内容は起動時に`~/demo`へ投入されますが、既存の`~/demo`がある場合は変更しません。既存folderを開くときも内容を追加しません。
- **停止操作** - RunPanelの停止は実行を終了し、TerminalのCtrl+CはプログラムのSIGINTハンドラーを呼び出す
- **分離した実行環境** - 実行ごとにmodule cacheやtimerなどの状態を作り直し、Workerは正常終了時に再利用
- **ファイル操作** - `fs`, `path`, `readline`, `userinterface` の対応APIを提供
- **TypeScript対応** - 拡張機能のトランスパイル設定でTypeScriptを実行
- **気軽にコード実行** - アルゴリズムテスト、学習、インタラクティブなコンソールアプリもOK

JavaScriptでは不可能なファイルオペレーションやインタラクティブな入出力（readline, userinterface）もエミュレートし、本格的なNode.js/TypeScript学習環境を提供。


> **制限事項**: ネイティブNode.jsアドオン、socket、HTTP server APIは利用できません。`child_process` はPyxisのシェル機能を通じて実行します。

---

### **Advanced Shell System - POSIX Shell Subset**
<div align="center">
  <img src="readme-assets/IMG_0126.png" alt="Advanced Shell System" width="80%" />
</div>

**ブラウザ上で実用的なシェルスクリプトを実行できます。** Pyxis独自のStreamShellは、パイプライン、リダイレクション、制御構文、変数展開など、POSIX shell構文の一部をサポートします。

#### 主な機能
- **パイプライン処理** - `cmd1 | cmd2 | cmd3` によるストリーム接続
- **リダイレクション** - `cmd > file`、`cmd >> file`、`cmd < file`、`cmd 2>&1` など
- **制御構文** - `if/then/else`、`for/while`、関数、`ERR`/`EXIT` trap、`set -e/-u/-o pipefail`
- **変数展開** - `$VAR`、parameter expansion、`$(command)` コマンド置換、`$((算術))` 算術展開
- **論理演算子** - `&&`、`||` による条件実行
- **バックグラウンド実行** - `cmd &` 非同期処理
- **ファイル操作** - `ls`、`cat`、`grep`、`head`、`tail`、`tr`、`awk` などUnixコマンド
- **スクリプト実行** - 現在の作業ディレクトリから解決した `.sh` ファイルを実行し、終了コードを返す

#### 技術的特徴
- **ストリーミングアーキテクチャ** - Node.js Stream APIによる真のストリーミング処理
- **バックプレッシャー対応** - メモリ効率の高いデータフロー制御
- **プロセス抽象化** - ブラウザ環境での仮想プロセス管理
- **fd管理** - ファイルディスクリプタのマッピングと複製

**シェルスクリプトの例：**
```bash
# パイプライン処理
cat large-file.txt | grep "error" | head -10

# リダイレクション
ls -la > directory-listing.txt 2>&1

# 制御構文
if [ -f "config.txt" ]; then
    echo "Config file exists"
    cat config.txt
else
    echo "Creating default config"
    echo "default=true" > config.txt
fi

# 算術展開
COUNT=$((COUNT + 1))
echo "Current count: $COUNT"
```

コマンド置換は親Terminalの作業ディレクトリを変更しません。shell構文とコマンドには未対応のものがあります。詳細は[Shell](docs/domain/shell.md)を参照してください。


> Note: 一部のシステムコマンドやバグ、機能はまだ完全には対応していません。今後のアップデートでさらに強化予定です。
issueで要望をお寄せください。

詳細は [Shell documentation](docs/domain/shell.md) を参照。

---

### Pyxis拡張機能システム
<div align="center">
  <img src="readme-assets/IMG_0113.png" alt="Pyxis Extension System UI" width="80%" />
</div>

<div align="center">
  <img src="readme-assets/IMG_0117.png" alt="Template CLI Screenshot" width="80%" />
</div>

Pyxis最大の特徴のひとつが「拡張機能システム」です。VSCodeライクなUI拡張・npm registry packageのinstall・Terminalコマンド拡張・多言語パック・トランスパイラ・サービス拡張などをTypeScript/TSXで追加できます。

#### 主なポイント
- **CLIテンプレート生成**：`pnpm run create-extension`で対話式テンプレート自動生成。初心者でも即拡張開発可能。
- **npm registry package対応**：package-lock.json v3を使った依存固定、複数packageの一括install、必須peer dependency、自動nested配置に対応。npm alias（`alias@npm:target@range`、scoped targetを含む）もCLIから指定できます。互換lock entryを優先し、新しいrangeでは条件を満たす`latest`を選びます。
- **Terminalコマンド拡張**：独自コマンドをAPIで追加し、PyxisターミナルUIから実行可能。
- **VSCodeライクなUI拡張**：カスタムタブ・サイドバーパネルをAPIで追加。React/TSXで直感的にUI構築。
- **多言語パック・サービス拡張**：言語パックや独自サービスも拡張機能として追加。
- **拡張機能の管理UI**：操作・検索・確認・失敗表示を20言語で表示します。拡張の名前と説明は配布元のmanifestに従います。
- **拡張機能の永続化**：登録情報と取得済みコードをブラウザ内に保存し、有効な拡張を次回起動時に復元します。

「VSCode級のUI拡張がWeb/iPadで動く」「Terminalコマンドも拡張可能」「公式テンプレートで即開発」など、他にない柔軟性と拡張性を持っています。

詳細は [Extension Readme](/extensions/README.md) や、より詳細な[拡張機能システム](docs/domain/extensions.md)と[作り方](docs/domain/extension-authoring.md)を参照。

---

---

### **スムーズなファイル・IDE操作**
<div align="center">
  <img src="readme-assets/IMG_1467.png" alt="ファイル　Operation Window" width="80%" />
</div>
<div align="center">
  <img src="readme-assets/IMG_0048.png" alt="検索" width="80%" />
</div>


**VS Codeのような効率性**でプロジェクトをナビゲート！高速ファイル検索オペレーションウィンドウなど、高速化つスムーズな、ストレスフリーなUXを提供します。

---

## なぜPyxisを選ぶべきか？

### **超高速 - 待ち時間ゼロ**
- **瞬間起動** - サーバーなし、ローディング画面なし、純粋なスピード
- **静的ホスティング** でまばたきより速く読み込み
- **ストレスフリー、ラグなし** - 思考の速度でコーディング

### **100%安全 - 何も壊れない**
- **サンドボックス環境** - 恐れることなく自由に実験
- **初心者のGitとコーディング学習に最適**
- **システム破損不可能** - ただのブラウザタブだから！

### **iPad ファースト - どこでもコーディング**
- **iPad で設計** された究極のモバイルコーディング体験
- **タッチ最適化インターフェース** とデュアルエディター対応
- **真のiPad開発** - ついに、タブレット用の本物のIDE

### auriデスクトップ対応
- Windows/Mac/LinuxでネイティブアプリとしてPyxisを利用可能
- Webと同じ体験をデスクトップで
- オフラインでも動作

### **AIサポート - シームレスな開発支援**
- **Ask & Edit機能** - 通常のブラウザでは何度もコピペが必要な作業を解決
- **コンテキスト保持** - 添付ファイルは保存・移動・削除に追従。未送信入力は同じページ内でAsk/Edit・workspaceを切り替えても保持
- **統合された体験** - VSCodeを開くほどではないが、AIの力は欲しい時に最適

### **ユニバーサル互換性**
- **どこでも動く** - Web、iPad、モバイル、全てのモダンブラウザ
- **マルチペーン対応** で複雑なプロジェクトも楽々
- **バイナリ表示** - ZIP解凍、PDF/画像/動画のプレビュー
- **🌍 20ヶ国語対応** - 日本語、英語、中国語、繁体字中国語、韓国語、スペイン語、フランス語、ドイツ語、イタリア語、ポルトガル語、ロシア語、オランダ語、トルコ語、アラビア語、ヒンディー語、タイ語、ベトナム語、インドネシア語、スウェーデン語、ポーランド語に対応
- **拡張機能システム** - 言語パック、トランスパイラ、カスタム機能を動的に追加

--- 

## Pyxisの独自性 - 他にはない組み合わせ

### **設計思想**
- **1秒起動** - サーバーレス静的ホスティングによる驚異的な速度
- **iPad最優先** - 実際にiPadで開発、デュアルエディター搭載
- **気軽さ重視** - VSCodeほど本格的ではないが、メモ帳をはるかに超える機能
- **Gitバージョン管理・GitHub連携** - ブランチ、マージ、リセット、.git込みダウンロード、PAT認証push/pull
- **高速Node.js** - 瞬時実行、ファイル操作エミュレート
- **こだわりのMD** - Markdown/Mermaid/LaTeX、ドキュメント・ブログ執筆に最適
- **AIサポート** - Ask/Edit機能で効率化
- **ライブリロード対応** - HTML/CSS/JS簡易サイト開発
- **バイナリ対応** - file bytesをOPFS、Git、runtime、upload/download、ZIP解凍まで保持。文字列へのdecodeはtext読込・明示したNode encoding・`.mjs` transpile・terminal表示時に限る
- **効率的編集** - キーボードショートカットで大量テキストも快適
- **マルチペーン** - 複数ウィンドウで同時作業
- **拡張機能アーキテクチャ** - 動的ロード、依存関係管理、永続化でモジュラーな設計

### **安全性**
ブラウザ上だから**何をしても壊れない**。PC環境で何かを削除すると取り返しがつかないが、Pyxisなら安心。初心者のGit学習にも最適。

### **将来の展望**
- **CAS導入** - Latexiumライブラリ開発中（symbolic computation対応予定）

---

## こんな使い方ができます

<div align="center">

| **iPadユーザー** |  **PC所有者** | **学習者** |
|:---:|:---:|:---:|
| 外出先で本格コーディング | VSCode起動は面倒な時に | Git操作を安全に練習 |
| ブログ記事をその場で執筆 | ちょっとしたコード編集 | Node.js基礎を学習 |
| ドキュメント作成・プレビュー | 長めのメモ・技術文書作成 | アルゴリズムテスト |
| 軽快な操作性で快適作業 | 1秒起動で即作業開始 | 何を壊しても安心な環境 |

</div>

---

## Tech

### [click me! 処理フローはこちら](./Development/all-flow.svg)

### **Front End**
- **React 19 + Vite** - 高速なクライアントサイドビルド
- **TypeScript** - 型安全な開発
- **Tailwind CSS** - 美しく、レスポンシブなデザイン

### Desktop (Tauri)
- Tauri - 軽量・高速なデスクトップアプリフレームワーク
- Rust - セキュアなネイティブランタイム

### **エディターとターミナル**
- **Monaco Editor** - VS Codeと同じエンジンを使用
- **xterm.js** - フル機能ターミナル体験
- **OPFS** - プロジェクトファイルとGit履歴を保存するブラウザ内ファイルシステム

### **ランタイムイノベーション**
- **node-stdlib-browser** - Node.js API互換性
- **fs module** - 気合いのエミュレーター全書き
- **isomorphic-git** - 純粋JavaScriptのGit実装

### **ファイルシステム設計**
OPFSを唯一のファイル保存先とし、IndexedDBにはフォルダー一覧やタブ、チャット、AIレビューなどのメタデータを保存します。詳細は[保存境界とpathモデル](docs/arch/storage.md)と[処理の流れ](docs/arch/data-flow.md)、文書全体は[docs/README.md](docs/README.md)をご覧ください。

エディタの保存・復元失敗は画面とOutputへ表示します。保存失敗時は未保存の編集を保持し、復元失敗時は空のエディタを開かず、タブを閉じて再度開くことで読み直せます。

fileを開く途中でworkspaceを切り替えた場合、古い読込結果は新しいタブsessionへ反映しません。

folderの削除・移動が途中で失敗した場合も、実際に消えた項目と残ったコピーを一覧へ反映します。復元するsymlink／FIFO recordは物理parentが残るものに限ります。詳細は[filesystem](docs/domain/filesystem.md)を参照してください。

Explorerの展開状態はfolderごとに復元します。ZIP exportはFIFO／deviceやそれらへのlinkをpath付きerrorで拒否し、読込待ちや一部entryの欠落を防ぎます。WebPreviewはHTMLの実要素・属性を解析し、script内の文字列と`data-*`を保ったままlocal assetsを埋め込みます。Git mergeのref保存失敗は元worktreeへ復元し、merge commit後のcleanup失敗は作成済みSHAを通知して再試行の重複commitを防ぎます。

幅640px以下ではExplorer・editor・AI panelを縦に並べ、両sidebarを開いても画面内で操作できます。desktopへ戻ると保存済みのsidebar幅を使います。詳細は[editorの画面構成](docs/domain/editor.md)をご覧ください。

### **作れるもの**

```javascript
// 🚀 本当に動くNode.jsアプリ！
const fs = require('fs');
const readline = require('readline');

// 本物のファイル操作
fs.writeFileSync('my-app.js', 'console.log("こんにちはPyxis!")');

// インタラクティブなコンソールアプリ
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('お名前は？ ', (name) => {
  console.log(`${name}さん、Pyxisへようこそ！ 🌟`);
  rl.close();
});
```

---

## 🚀 クイックスタートガイド

### **1. クリックしてコーディング開始！**
1. **[Pyxis を開く](https://Stasshe.github.io/Pyxis-CodeCanvas)** - どのブラウザでも
2. *タイプ開始** - サインアップ不要、ダウンロード不要

### Tauriデスクトップ版の使い方
1. リポジトリをクローンし、tauriブランチに切り替え
2. RustとNode.jsをインストール
3. pnpm install で依存を導入
4. pnpm exec tauri dev でデスクトップアプリを起動
5. Web版と同じPyxis体験をデスクトップで！

### **2. 初めてのPyxisプロジェクト**

**シンプルなNode.jsアプリを作成：**
```javascript
// app.js
const fs = require('fs');

// 初めてのファイルを書く
fs.writeFileSync('hello.txt', 'Pyxisからこんにちは！ 🚀');

// 読み戻す
const message = fs.readFileSync('hello.txt', 'utf8');
console.log(message);

console.log('Pyxisへようこそ - どこでもコーディング！ ✨');
```
Git練習
```
git add .
git commit -m "初めてのPyxisプロジェクト！ 🎉"

# フィーチャーブランチ作成
git checkout -b my-awesome-feature

# 美しい差分ビュー
git diff [branchName]
```

**リッチなドキュメント作成：**
```markdown
# 私のプロジェクト

## アーキテクチャ
```mermaid
graph TD
    A[ユーザー] --> B[Pyxis IDE]
    B --> C[Node.js ランタイム]
    B --> D[Git システム]
    C --> E[ファイル システム]

## 数式
$$E = mc^2$$
```
**タイプするだけでリアルタイムプレビュー！**

---

## ブラウザ互換性

| ブラウザ | サポート | 備考 |
|---------|---------|-------|
| 🟢 **Chrome/Edge** | Chromeで確認済み | Edgeは未計測 |
| 🟢 **Safari (iPad)** | Safari 26+ | 実機未計測 |
| 🟡 **Firefox** | 未計測 | 対応状況は未確認 |
| 🟡 **モバイル** | 良好 | タッチ最適化インターフェース |
| 🟢 Tauri (Desktop) | 完璧 | Windows/Mac/Linuxで動作 |

永続fileのrenameにはOPFSの`FileSystemFileHandle.move()`が必要です。ChromeのOPFSでは確認済みです。Safariは26以降を対象としますが、SafariとFirefoxでの動作は未計測です。

**システム要件：** モダンブラウザと2GB+のRAMでスムーズな体験。

---

## インストール方法

### 推奨: pnpm (高速・効率的)
```bash
# pnpmをインストール (未インストールの場合)
npm install -g pnpm

# 依存関係をインストール
pnpm install

# 開発サーバー起動
pnpm run dev

# 本番ビルド
pnpm run build
pnpm run preview
```

### npm でも可能
```bash
npm install
npm run dev
npm run build
npm run preview
```

or, if you use tauri, use "tauri" branch.

```
npm i

npx tauri dev
```

---

## Pyxisコミュニティに参加

### **あなたの力をお貸しください！**

貢献の方法はたくさんあります：

- **バグを見つけた？** 報告してPyxisをより良くしましょう
- **アイデアがある？** 機能提案をシェアしてください
- **ドキュメント改善** - 他の人にも伝えましょう
- **コード貢献** - 新機能追加やイシュー修正
- **リポジトリにスター** - 本当に成長の助けになります！

### **Thanks**

Pyxisを可能にした素晴らしいオープンソースプロジェクトに心から感謝：
- **Monaco Editor** - ブラウザでのVS Code
- **isomorphic-git** - Gitをウェブに
- **React & Vite** - モダンウェブアプリの基盤

---

## 📄 ライセンス

MIT License - 使って、改造して。詳細は[LICENSE](LICENSE)をご覧ください。

---

<div align="center">

## 制限なしのコーディングの準備はできましたか？

**[Pyxis を今すぐ起動](https://Stasshe.github.io/Pyxis-CodeCanvas)**

*ダウンロード不要。セットアップ不要。純粋なコーディング。* ✨

**Dev Server: [pyxis-code.onrender.com](https://pyxis-code.onrender.com)**

---

### シェアしよう

**Pyxisが気に入った？** リポジトリに⭐をつけて、仲間の開発者にシェアしてください！

**バグを見つけた？** [こちらで報告](issues/)して改善にご協力ください

---

<img src="public/favicon.png" alt="Pyxis ロゴ" width="64" height="64" />

*「制限なく、いつでも、どこでもコーディング」*

</div>
