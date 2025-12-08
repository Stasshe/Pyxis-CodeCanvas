# R Runtime Extension

PyxisでRコードをブラウザ上で実行するための拡張機能。

## 概要

この拡張機能は、[webR](https://docs.r-wasm.org/webr/latest/)を使用してブラウザ内でRコードを実行します。WebAssemblyベースのため、サーバーサイド処理なしで完全にクライアント側でRの統計計算が動作します。

## 機能

- ✅ `.r`/`.R`ファイルの実行
- ✅ Rコードスニペットの実行
- ✅ 標準出力/標準エラー出力のキャプチャ
- ✅ R 4.3系の統計計算機能
- ✅ 多くの標準パッケージをサポート

## 使用例

### 基本的なRコード

```r
# hello.R
print("Hello, R!")
cat("R version:", R.version.string, "\n")

# ベクトル操作
x <- 1:10
print(sum(x))
print(mean(x))
```

### 統計計算

```r
# statistics.R
# データ生成
data <- rnorm(100, mean = 50, sd = 10)

# 基本統計量
cat("Mean:", mean(data), "\n")
cat("Median:", median(data), "\n")
cat("SD:", sd(data), "\n")
cat("Min:", min(data), "\n")
cat("Max:", max(data), "\n")

# 要約統計
summary(data)
```

### データフレーム操作

```r
# dataframe.R
# データフレーム作成
df <- data.frame(
  name = c("Alice", "Bob", "Charlie"),
  age = c(25, 30, 35),
  score = c(85, 92, 78)
)

print(df)

# フィルタリング
high_scorers <- df[df$score > 80, ]
print(high_scorers)

# 集計
cat("Average age:", mean(df$age), "\n")
cat("Average score:", mean(df$score), "\n")
```

### 行列計算

```r
# matrix.R
# 行列作成
m1 <- matrix(1:9, nrow = 3)
m2 <- matrix(9:1, nrow = 3)

print("Matrix 1:")
print(m1)

print("Matrix 2:")
print(m2)

print("Matrix multiplication:")
print(m1 %*% m2)

print("Element-wise multiplication:")
print(m1 * m2)
```

## 技術仕様

### 使用ライブラリ

- **[webR](https://docs.r-wasm.org/webr/latest/)** v0.4.2+
- R 4.3系のWebAssemblyビルド
- 多くの標準パッケージ同梱

### サポートされる機能

1. **基本統計**: mean, median, sd, var, summary等
2. **データ構造**: vector, matrix, data.frame, list
3. **制御構文**: if, for, while, repeat
4. **関数定義**: function, apply系関数
5. **標準パッケージ**: stats, graphics, utils, datasets等

### 制限事項

1. **グラフィックス**: プロットは現在サポートされていません（将来的に追加予定）
2. **外部パッケージ**: CRANからの追加パッケージインストールは制限されています
3. **ファイルI/O**: ブラウザ環境のため、ローカルファイルシステムへの直接アクセスは制限されます
4. **パフォーマンス**: WebAssembly上での実行のため、ネイティブRと比較すると低速です

### なぜRを選んだか

- **人気**: データサイエンス・統計分野で非常に人気の高い言語
- **webRの成熟度**: Posit（旧RStudio）が開発する安定したWebAssembly実装
- **充実した機能**: 統計計算、データ処理が完全にブラウザで動作
- **優れた互換性**: R 4.3系の完全な互換性と多数のパッケージサポート

## インストール

この拡張機能はデフォルトで有効になっています。無効化されている場合は、拡張機能パネルから有効化できます。

## 開発

```bash
# 依存関係のインストール
cd extensions/r-runtime
pnpm install

# ビルド
cd ../..
pnpm run setup-build
```

## トラブルシューティング

### webRの初期化に失敗する

- インターネット接続を確認してください（CDNからWASMファイルをダウンロードします）
- ブラウザのコンソールでエラーメッセージを確認してください

### コードが実行されない

- Rファイルの拡張子が`.r`または`.R`であることを確認してください
- ブラウザのコンソールでエラーログを確認してください

### パフォーマンスが遅い

- WebAssemblyベースのため、ネイティブRより遅くなります
- 大規模なデータセットや複雑な計算は時間がかかる場合があります

## 参考リンク

- [webR公式ドキュメント](https://docs.r-wasm.org/webr/latest/)
- [R公式サイト](https://www.r-project.org/)
- [RStudio (Posit)](https://posit.co/)

## ライセンス

MIT
