<div align="center">
  <img src="readme-assets/IMG_1473.png" alt="Pyxis カバー画像" width="100%" />
  
  # 🌟 Pyxis - Client Side Code Editor

  ## [📖 English Version README](README_en.md)
  
  ### *セットアップゼロ。素早く起動、気軽にコーディング*
  
  [![Version](https://img.shields.io/badge/version-0.5.2-blue.svg)](https://github.com/your-username/pyxis)
  [![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
  [![Platform](https://img.shields.io/badge/platform-Web%20%7C%20iPad%20%7C%20Mobile-orange.svg)](README.md)
  [![Tauri](https://img.shields.io/badge/Tauri-Desktop-blueviolet?logo=tauri)](https://tauri.app/)
  [![Next.js](https://img.shields.io/badge/Next.js-15-blue?logo=next.js)](https://nextjs.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3.4.1-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-v5-3178c6?logo=typescript)](https://www.typescriptlang.org/)
  [![React](https://img.shields.io/badge/React-19-61dafb?logo=react)](https://react.dev/)
  [![Last Commit](https://img.shields.io/github/last-commit/Stasshe/Pyxis-Client-Side-Code-Editor?logo=github)](https://github.com/Stasshe/Pyxis-Client-Side-Code-Editor/commits/main)
  [![Bundle Size](https://img.shields.io/badge/bundle--size-1.04MB-purple?logo=next.js)](#)
  
  **[🚀 Pyxis を今すぐ試す](https://pyxis-code.onrender.com)**
</div>

---

## ✨ Pyxis って何？

**Pyxisは、iPad向けに設計された1秒で起動する高機動なブラウザIDEです。**

### 🎯 こんな人のために作りました

<div align="center">

| 📱 **iPadユーザー** | 💻 **PC所有者** |
|:---:|:---:|
| iPadで本格的にコーディング | VSCodeを開くほどではない |
| Stackblitzは重すぎる | ちょっとしたコード編集 |
| タッチ操作に最適化されたIDE | 長めのメモを取りたい |
| 軽快な動作が欲しい | 気軽にサッと使いたい |

</div>

### 🚀 Stackblitzとの違い

Stackblitzは非常に高度なIDEですが、以下の課題があります：
- **iPadでの動作が重い** - メモリ消費が大きい
- **Web開発に特化** - 他の用途には向かない
- **画面が小さいと操作しづらい** - モバイル最適化が不十分
- **iPad操作に最適化されていない** - タッチUIが不便

**Pyxisはこれらの課題を解決します：**
- ⚡ **1秒で起動** - サーバーレス静的ホスティングによる超高速起動
- 📱 **iPad最適化** - タッチ操作とデュアルエディター対応
- 🎨 **汎用性** - Web開発だけでなく、ドキュメント作成やメモにも最適
- 🪶 **軽量動作** - iPadでも快適に動作

> 💡 **パソコンのような操作性とiPadの機動性を両立！**
> 🖥️ **Tauriデスクトップ版もサポート！** Windows/Mac/LinuxでネイティブアプリとしてPyxisを利用できます。

---

## 🚀 Pyxisの革新的機能

### � **Markdown・Mermaid・LaTeX - 高品質ドキュメント作成**
<div align="center">
  <img src="readme-assets/IMG_1470.png" alt="リッチコンテンツ編集" width="80%" />
</div>

**Pyxisはマークダウンビューワーに特にこだわっています。**
- 📄 **ドキュメント作成** - 技術文書、仕様書を美しく
- ✍️ **ブログ記事執筆** - リアルタイムプレビューで効率的に
- 📊 **Mermaid対応** - フローチャート、図表を簡単作成
- 🔢 **LaTeX数式** - 数学的な表現も完璧にレンダリング

タイプするだけで即座にプレビュー更新！長文の執筆にも最適です。

---

### 🔥 **ホットモジュールリプレースメント（HMR）- 簡易サイト構築**
<div align="center">
  <img src="readme-assets/IMG_1465.png" alt="HMR の動作画面" width="80%" />
</div>

**HTML/CSS/JSのみ対応** - ブラウザでしかテストできないが、環境整備は面倒。そんな時に、とても便利。
- リアルタイム更新で即座に結果確認
- 簡易的なWeb開発に最適
- セットアップ不要でサッと使える

> **注意**: 現在はHTML/CSS/JSのみ対応。WebContainerの統合は将来的な計画です（iPadのメモリ制約により、実装は慎重に検討中）。

---

### 🔄 **ローカルGit - バージョン管理をブラウザで**
<div align="center">
  <img src="readme-assets/IMG_1466.png" alt="Git 差分の可視化" width="80%" />
</div>

**ローカルGitはほぼ完成！** ブランチ、マージ、コミット、リセットなど、主要なGit機能をブラウザ上で実現。
- 🎨 **ビジュアル差分** - コード変更を美しく可視化
- 🌿 **ブランチ操作** - 安全に実験、いつでも戻せる
- 💾 **.git込みでダウンロード** - 設定から.gitを含めて丸ごとエクスポート可能
- 🛡️ **安全な学習環境** - 何を壊しても大丈夫！初心者のGit練習に最適

> **GitHub連携について**: GitHubの申請承認待ちのため、リモートリポジトリ連携は現在実装を保留中です。ローカルGitは完全に動作します。

---

### ⚡ **Node.js ランタイム - 超高速実行環境**
<div align="center">
  <img src="readme-assets/IMG_1469.png" alt="Node.js 実行画面" width="80%" />
</div>

**WASMを使わない独自実装** - だから実行が驚くほど速い！
- ⚡ **瞬時に実行** - コンパイル不要、待ち時間ゼロ
- 📁 **ファイル操作** - fs、path、readlineなど主要モジュール対応
- 🎯 **気軽にコード実行** - アルゴリズムテスト、学習に最適

JavaScriptでは不可能なファイルオペレーション機能をエミュレートし、本格的なNode.js学習環境を提供。

> **制限事項**: WASMを使用していないため、ネイティブモジュールやchild_processなど一部機能は未対応です。基本的なNode.js学習や簡易スクリプト実行には十分です。

---

### **スマートファイル操作 - 何でも瞬時に発見**
<div align="center">
  <img src="readme-assets/IMG_1467.png" alt="ファイル操作" width="80%" />
</div>

**VS Code並みの効率性**でプロジェクトをナビゲート！高速ファイル検索、インテリジェントなオートコンプリート、強力なコマンドでコーディングが楽しくなります。

---

## 🎯 なぜPyxisを選ぶべきか？

### **超高速 - 待ち時間ゼロ**
- **瞬間起動** - サーバーなし、ローディング画面なし、純粋なスピード
- **静的ホスティング** でまばたきより速く読み込み
- **ストレスフリー、ラグなし** - 思考の速度でコーディング

### 🛡️ **100%安全 - 何も壊れない**
- **サンドボックス環境** - 恐れることなく自由に実験
- **初心者のGitとコーディング学習に最適**
- **システム破損不可能** - ただのブラウザタブだから！

### **iPad ファースト - どこでもコーディング**
- **iPad で設計** された究極のモバイルコーディング体験
- **タッチ最適化インターフェース** とデュアルエディター対応
- **真のiPad開発** - ついに、タブレット用の本物のIDE

### 🖥️ Tauriデスクトップ対応
- Windows/Mac/LinuxでネイティブアプリとしてPyxisを利用可能
- Webと同じ体験をデスクトップで
- オフラインでも動作

### 🤖 **AIサポート - シームレスな開発支援**
- **Ask & Edit機能** - 通常のブラウザでは何度もコピペが必要な作業を解決
- **コンテキスト保持** - ファイルを開いたまま、AIに質問・編集依頼
- **統合された体験** - VSCodeを開くほどではないが、AIの力は欲しい時に最適

### 🌐 **ユニバーサル互換性**
- **どこでも動く** - Web、iPad、モバイル、全てのモダンブラウザ
- **マルチペーン対応** で複雑なプロジェクトも楽々
- **バッファコンテンツ対応** - zip解凍、PDF、画像、動画表示

--- 

## 🌟 Pyxisの独自性 - 他にはない組み合わせ

### **設計思想**
- ⚡ **1秒起動** - サーバーレス静的ホスティングによる驚異的な速度
- 📱 **iPad最優先** - 実際にiPadで開発、デュアルエディター搭載
- 🎯 **気軽さ重視** - VSCodeほど本格的ではないが、メモ帳以上の機能

### **実装済み機能**
- 🔄 **ローカルGit完備** - ブランチ、マージ、リセット、.git込みダウンロード
- ⚡ **高速Node.js** - WASMなしで瞬時実行、ファイル操作エミュレート
- 📝 **こだわりのMD** - Markdown/Mermaid/LaTeX、ドキュメント・ブログ執筆に最適
- 🤖 **AIサポート** - Ask/Edit機能で効率化
- 🔥 **HMR対応** - HTML/CSS/JS簡易サイト開発
- 📦 **バッファ対応** - ZIP解凍、PDF/画像/動画ビューワー
- ⌨️ **効率的編集** - キーボードショートカットで大量テキストも快適
- 🖼️ **マルチペーン** - 複数ウィンドウで同時作業

### **安全性**
ブラウザ上だから**何をしても壊れない**。PC環境で何かを削除すると取り返しがつかないが、Pyxisなら安心。初心者のGit学習にも最適。

### **将来の展望**
- 🚧 **WebContainer統合** - iPadメモリ制約のため慎重に検討中（簡易Node.jsアプリ実行は可能に）
- 🔗 **GitHub連携** - 申請承認待ち、ローカルGitは完成
- 🧮 **CAS導入** - Latexiumライブラリ開発中（symbolic computation対応予定）

---

## 🎪 こんな使い方ができます

<div align="center">

| � **iPadユーザー** |  **PC所有者** | 👨‍🎓 **学習者** |
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
- **Next.js 15** と React 19 - 最新で最高
- **TypeScript** - 型安全な開発
- **Tailwind CSS** - 美しく、レスポンシブなデザイン

### Desktop (Tauri)
- Tauri - 軽量・高速なデスクトップアプリフレームワーク
- Rust - セキュアなネイティブランタイム

### **エディターとターミナル**
- **Monaco Editor** - VS Codeと同じエンジンを使用
- **xterm.js** - フル機能ターミナル体験
- **Lightning FS** - 超高速ファイルシステム

### **ランタイムイノベーション**
- **node-stdlib-browser** - Node.js API互換性
- **fs module** - 気合いのエミュレーター全書き
- **isomorphic-git** - 純粋JavaScriptのGit実装

### **Pyxisのデータベース・ファイルシステム設計に興味がある方へ**
- Pyxisの内部アーキテクチャやデータベース設計、ファイルシステムの詳細な仕様\n
- **非常に高度な内容**をまとめた[Development/DATABASE.md](Development/DATABASE.md)をご覧ください。
\n\n> 
データフローやIndexedDBの構造、仮想ファイルシステムの仕組みなど、\n> 開発者・研究者向けの深い技術情報を掲載しています。

### 🎨 **作れるもの**

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
1. 🌐 **[Pyxis を開く](https://pyxis-code.onrender.com)** - どのブラウザでも
2. 📝 **タイプ開始** - サインアップ不要、ダウンロード不要
3. 🎯 **下の例を試す** - 即座に体験

### Tauriデスクトップ版の使い方
1. リポジトリをクローンし、tauriブランチに切り替え
2. RustとNode.jsをインストール
3. npm install で依存を導入
4. npx tauri dev でデスクトップアプリを起動
5. Web版と同じPyxis体験をデスクトップで！
* [Tauri Setup Guide](./Development/Tauri-Setup.md)

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

## 🌈 ブラウザ互換性

| ブラウザ | サポート | 備考 |
|---------|---------|-------|
| 🟢 **Chrome/Edge** | 完璧 | 最高の体験にお勧め |
| 🟢 **Safari (iPad)** | 優秀 | iPadに特別最適化 |
| 🟡 **Firefox** | 良好 | 全機能動作 |
| 🟡 **モバイル** | 良好 | タッチ最適化インターフェース |
| 🟢 Tauri (Desktop) | 完璧 | Windows/Mac/Linuxで動作 |

**システム要件：** モダンブラウザと2GB+のRAMでスムーズな体験。

---

## インストール方法
```
npm i

#development server
npm run dev

#production mode
npm run build
npm run preview
```

or, if you use tauri, use "tauri" branch.
* check this guide! [Tauri Setup Guide](./Development/Tauri-Setup.md)

```
npm i

npx tauri dev
```

---

## 🎉 Pyxisコミュニティに参加

### 💝 **あなたの力をお貸しください！**

貢献の方法はたくさんあります：

- 🐛 **バグを見つけた？** 報告してPyxisをより良くしましょう
- 💡 **アイデアがある？** 機能提案をシェアしてください
- **ドキュメント改善** - 他の人にも伝えましょう
- 🔧 **コード貢献** - 新機能追加やイシュー修正
- ⭐ **リポジトリにスター** - 本当に成長の助けになります！

### 🌟 **Thanks**

Pyxisを可能にした素晴らしいオープンソースプロジェクトに心から感謝：
- **Monaco Editor** - ブラウザでのVS Code
- **isomorphic-git** - Gitをウェブに
- **Next.js & React** - モダンウェブアプリの基盤

---

## 📄 ライセンス

MIT License - 使って、改造して。詳細は[LICENSE](LICENSE)をご覧ください。

---

<div align="center">

## 🚀 制限なしのコーディングの準備はできましたか？

**[✨ Pyxis を今すぐ起動](https://pyxis-code.onrender.com)**

*ダウンロード不要。セットアップ不要。純粋なコーディング。* ✨

---

### シェアしよう

**Pyxisが気に入った？** リポジトリに⭐をつけて、仲間の開発者にシェアしてください！

**バグを見つけた？** [こちらで報告](issues/)して改善にご協力ください

---

<img src="public/favicon.png" alt="Pyxis ロゴ" width="64" height="64" />

*「制限なく、いつでも、どこでもコーディング」*

</div>
