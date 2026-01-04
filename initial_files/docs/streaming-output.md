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
2. **直接実行**: 最後の手段として、Node.jsを直接実行（システムによってはバッファリングされる可能性あり）

### 実装の詳細

```bash
if command -v stdbuf >/dev/null 2>&1; then
  # 推奨: stdbufを使用
  stdbuf -o0 -e0 node src/index.js
else
  if command -v python3 >/dev/null 2>&1; then
    # フォールバック1: Python経由で実行
    python3 -u -c "import sys, subprocess; \
      proc = subprocess.Popen(['node', 'src/index.js']); \
      sys.exit(proc.wait())"
  else
    # フォールバック2: 直接実行
    node src/index.js
  fi
fi
```

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

### 出力例

```
開始: ストリーミングテスト
出力 1/5 - 時刻: 9:00:19 AM
出力 2/5 - 時刻: 9:00:20 AM  ← 1秒後にリアルタイムで表示
出力 3/5 - 時刻: 9:00:21 AM  ← さらに1秒後に表示
出力 4/5 - 時刻: 9:00:22 AM
出力 5/5 - 時刻: 9:00:23 AM
完了: すべての出力が終了しました
```

## 技術的な詳細

### バッファリングモード

- **Unbuffered (0)**: データが書き込まれるとすぐに出力される（`stdbuf -o0`）
- **Line buffered (L)**: 改行文字が出力されるまでバッファリングされる（`stdbuf -oL`）
- **Fully buffered (デフォルト)**: バッファがいっぱいになるか、プログラムが終了するまでバッファリングされる

### `exec` によるリダイレクト

`run-test.sh` では、シェル自体の出力も unbuffered にするために以下のコマンドを使用しています：

```bash
# Bash 4以上でのみ使用（プロセス置換のサポート確認）
if [[ $BASH_VERSINFO -ge 4 ]]; then
  exec 1> >(exec cat -)
  exec 2> >(exec cat - >&2)
fi
```

これにより、`echo` などのシェルコマンドの出力も即座に表示されます。

### CPU効率的な待機

`streaming-test.js` では、CPU負荷を最小限にするため、busy-wait ループの代わりに `async/await` と `setTimeout` を使用しています：

```javascript
// CPU効率的な待機関数
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  for (let i = 1; i <= 5; i++) {
    console.log(`出力 ${i}/5`);
    await sleep(1000);  // CPU負荷なしで1秒待機
  }
}
```

## 互換性

- **Linux**: `stdbuf` コマンドが標準で利用可能（GNU coreutils）
- **macOS**: `stdbuf` が利用できない場合があるため、Pythonフォールバックを使用
- **Windows**: `stdbuf` は利用できないため、Pythonまたは直接実行にフォールバック

## 参考

- [GNU Coreutils - stdbuf](https://www.gnu.org/software/coreutils/manual/html_node/stdbuf-invocation.html)
- [Node.js Stream API](https://nodejs.org/api/stream.html)
- [TTY (端末) の概念](https://nodejs.org/api/tty.html)
- [Bash Process Substitution](https://www.gnu.org/software/bash/manual/html_node/Process-Substitution.html)
