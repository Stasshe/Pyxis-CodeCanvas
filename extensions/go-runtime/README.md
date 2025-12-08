# Go Runtime Extension

PyxisでGoコードをブラウザ上で実行するための拡張機能（実験的・機能制限あり）。

## ⚠️ 重要な注意事項

この拡張機能は**実験的**なものであり、**大幅な機能制限**があります。

### 制限事項

1. **GopherJSの制約**: GopherJSはサーバーサイドでのコンパイルが必要なため、ブラウザ上での動的なGo実行は非常に困難です
2. **再現率が低い**: 完全なGo標準ライブラリのサポートはありません
3. **限定的な実装**: 現在の実装は基本的な`fmt.Println`文のみをシミュレートします
4. **本格的な使用には不向き**: デモンストレーション目的の実装であり、実用には適していません

## 概要

Go言語の完全なブラウザ実行には、以下のような技術的課題があります：

- **GopherJS**: Goコードを JavaScript にトランスパイルしますが、事前コンパイルが必要
- **TinyGo**: WebAssemblyサポートがありますが、動的コンパイルには対応していません
- **Go Playground API**: サーバーサイドの実行環境が必要

現在のブラウザベースのアーキテクチャでは、これらの制約により完全なGo実行環境を提供することができません。

## 現在サポートされている機能

### 基本的な出力（シミュレート）

```go
package main

import "fmt"

func main() {
    fmt.Println("Hello, Go!")
}
```

このような単純な`fmt.Println`文は、パターンマッチングにより出力をシミュレートします。

## サポートされていない機能

以下を含むほとんどのGo機能は動作しません：

- ❌ 変数宣言と計算
- ❌ 関数定義
- ❌ 制御構文（if, for, switch等）
- ❌ 構造体とメソッド
- ❌ ゴルーチンとチャネル
- ❌ パッケージのインポート
- ❌ ファイルI/O
- ❌ ネットワーク処理

## 推奨される代替方法

実際にGoコードを実行したい場合は、以下の方法を検討してください：

1. **ローカル環境**: Go言語の公式実装をインストール
   ```bash
   # macOS
   brew install go
   
   # Ubuntu/Debian
   sudo apt install golang-go
   ```

2. **Go Playground**: オンラインでGoコードを実行
   - https://go.dev/play/

3. **Docker**: コンテナ環境でGoを実行
   ```bash
   docker run --rm -v "$PWD":/usr/src/myapp -w /usr/src/myapp golang:1.21 go run main.go
   ```

## 技術的背景

### なぜブラウザでのGo実行が難しいのか

1. **コンパイル言語**: Goは静的型付けのコンパイル言語であり、実行前にコンパイルが必要
2. **WebAssemblyの制約**: Go WebAssemblyはブラウザで動作しますが、動的コンパイルには対応していません
3. **GopherJSの設計**: JavaScript へのトランスパイルにはビルドステップが必要
4. **ランタイムの複雑さ**: Goランタイム（ゴルーチンスケジューラなど）をブラウザで完全にエミュレートすることは困難

### 将来の改善可能性

以下のような技術の発展により、将来的に改善される可能性があります：

- **WASI (WebAssembly System Interface)** の発展
- **動的WebAssemblyコンパイル** のサポート
- **ブラウザベースのGoコンパイラ** の開発

## インストール

この拡張機能はデフォルトで**無効**になっています。制限事項を理解した上で、拡張機能パネルから有効化できます。

## 開発

```bash
# ビルド
cd /path/to/Pyxis-CodeCanvas
pnpm run setup-build
```

## まとめ

この拡張機能は、Pyxisの拡張機能システムの柔軟性を示すデモンストレーションとして提供されています。
実用的なGo開発には、ローカル環境またはサーバーベースのソリューションを使用することを強く推奨します。

## 参考リンク

- [Go公式サイト](https://go.dev/)
- [GopherJS](https://github.com/gopherjs/gopherjs)
- [TinyGo](https://tinygo.org/)
- [Go Playground](https://go.dev/play/)

## ライセンス

MIT
