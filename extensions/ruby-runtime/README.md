# Ruby Runtime Extension

PyxisでRubyコードをブラウザ上で実行するための拡張機能。

## 概要

この拡張機能は、[ruby.wasm](https://github.com/ruby/ruby.wasm)を使用してブラウザ内でRubyコードを実行します。WebAssemblyベースのため、サーバーサイド処理なしで完全にクライアント側でRubyが動作します。

## 機能

- ✅ `.rb`ファイルの実行
- ✅ Rubyコードスニペットの実行
- ✅ 標準出力/標準エラー出力のキャプチャ
- ✅ Ruby 3.2系の標準ライブラリサポート

## 使用例

### 基本的なRubyコード

```ruby
# hello.rb
puts "Hello, Ruby!"
puts "Ruby version: #{RUBY_VERSION}"

5.times do |i|
  puts "Count: #{i + 1}"
end
```

### 文字列操作

```ruby
# string_demo.rb
str = "Hello, World!"
puts str.upcase
puts str.downcase
puts str.reverse

words = str.split(", ")
puts words.inspect
```

### 配列とハッシュ

```ruby
# data_structures.rb
# 配列
numbers = [1, 2, 3, 4, 5]
puts "Sum: #{numbers.sum}"
puts "Average: #{numbers.sum / numbers.size.to_f}"

# ハッシュ
person = {
  name: "Alice",
  age: 30,
  city: "Tokyo"
}
puts person.inspect
puts "Name: #{person[:name]}"
```

## 技術仕様

### 使用ライブラリ

- **[@ruby/wasm-wasi](https://www.npmjs.com/package/@ruby/wasm-wasi)** v2.5.0
- Ruby 3.2系のWebAssemblyビルド
- 標準ライブラリ同梱版を使用

### 制限事項

1. **ファイルI/O**: ブラウザ環境のため、ローカルファイルシステムへの直接アクセスは制限されます
2. **ネットワーク**: 一部のネットワーク機能は動作しない可能性があります
3. **拡張ライブラリ**: CエクステンションなどのネイティブGemは使用できません
4. **パフォーマンス**: WebAssembly上での実行のため、ネイティブRubyと比較すると低速です

### サポートされる標準ライブラリ

ruby.wasmには以下を含む多くの標準ライブラリが含まれています：

- StringIO
- JSON
- Set
- Date/Time
- URI
- Base64
- その他多数

## インストール

この拡張機能はデフォルトで有効になっています。無効化されている場合は、拡張機能パネルから有効化できます。

## 開発

```bash
# 依存関係のインストール
cd extensions/ruby-runtime
pnpm install

# ビルド
cd ../..
pnpm run setup-build
```

## トラブルシューティング

### Ruby.wasmの初期化に失敗する

- インターネット接続を確認してください（CDNからWASMファイルをダウンロードします）
- ブラウザのコンソールでエラーメッセージを確認してください

### コードが実行されない

- Rubyファイルの拡張子が`.rb`であることを確認してください
- ブラウザのコンソールでエラーログを確認してください

## 参考リンク

- [ruby.wasm公式ドキュメント](https://github.com/ruby/ruby.wasm)
- [Ruby公式サイト](https://www.ruby-lang.org/)

## ライセンス

MIT
