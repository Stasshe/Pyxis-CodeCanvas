# ストリーミング出力について

## 問題

通常、`node src/index.js` を直接実行すると、出力がリアルタイムでストリーミングされます。しかし、シェルスクリプト（例：`run-test.sh`）経由で実行すると、すべての処理が完了するまで出力がバッファリングされ、リアルタイムで表示されない問題がありました。

## 原因

この問題の主な原因は以下の通りです：

1. **Node.jsの出力バッファリング**: Node.jsは標準出力（stdout）がTTY（端末）でない場合、パフォーマンス向上のために出力をバッファリングします
2. **シェルスクリプトのバッファリング**: シェルスクリプト自体も、パイプやリダイレクトを使用する場合に出力をバッファリングすることがあります

## 解決方法

### `stdbuf` コマンドの使用

`run-test.sh` では、`stdbuf` コマンドを使用して出力バッファリングを無効化しています：

```bash
# -o0: 標準出力のバッファリングを無効化（unbuffered）
# -e0: 標準エラー出力のバッファリングを無効化（unbuffered）
stdbuf -o0 -e0 node src/index.js
```

### フォールバック方法

`stdbuf` が利用できない環境では、以下のフォールバック方法を使用します：

1. **Pythonの unbuffered モード**: `python3 -u` を使用してNode.jsを起動
2. **直接実行**: 最後の手段として、Node.jsを直接実行

## テスト方法

### 直接実行（リアルタイム出力）

```bash
cd initial_files
node src/streaming-test.js
```

### シェルスクリプト経由（修正後もリアルタイム出力）

```bash
cd initial_files
bash run-test.sh
# または
bash test-streaming.sh
```

## 技術的な詳細

### バッファリングモード

- **Unbuffered (0)**: データが書き込まれるとすぐに出力される（`stdbuf -o0`）
- **Line buffered (L)**: 改行文字が出力されるまでバッファリングされる（`stdbuf -oL`）
- **Fully buffered (デフォルト)**: バッファがいっぱいになるか、プログラムが終了するまでバッファリングされる

### `exec` によるリダイレクト

`run-test.sh` では、シェル自体の出力も unbuffered にするために以下のコマンドを使用しています：

```bash
exec 1> >(exec cat -)
exec 2> >(exec cat - >&2)
```

これにより、`echo` などのシェルコマンドの出力も即座に表示されます。

## 参考

- [GNU Coreutils - stdbuf](https://www.gnu.org/software/coreutils/manual/html_node/stdbuf-invocation.html)
- [Node.js Stream API](https://nodejs.org/api/stream.html)
- [TTY (端末) の概念](https://nodejs.org/api/tty.html)
