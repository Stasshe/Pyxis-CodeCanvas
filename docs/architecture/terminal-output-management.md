# Terminal Output Management - Architecture Documentation

## 問題の本質

ターミナルで「最終行がプロンプトと重なる」問題は、以下の根本的な設計の欠陥から生じていた：

### 以前の問題点

1. **複数の出力経路**: `term.write()`, `term.writeln()`, `writeOutput()`, `captureWriteOutput()` など、様々な経路から直接xtermに書き込みが行われていた
2. **手動の状態管理**: `atLineStart` フラグを各所で手動更新する必要があり、更新漏れが発生しやすかった  
3. **一貫性のない改行処理**: コマンドごとに改行の扱いが異なり、統一されたルールがなかった
4. **レースコンディション**: 非同期出力時のキュー管理が不十分で、出力が混ざる可能性があった

## 解決アプローチ

### Linux/Windowsターミナルの標準動作

実際のターミナルエミュレータは以下の仕組みで動作している：

| レイヤー | 責務 |
|---------|------|
| Application Layer | コマンド実行・出力生成 |
| Terminal Driver (PTY/TTY) | - カーソル位置追跡 (X, Y)<br>- 改行自動変換 (\n → \r\n)<br>- バッファリング |
| Terminal Emulator (xterm) | - ANSIシーケンス処理<br>- 画面レンダリング |

**重要なポイント**:
- カーソル位置は常に追跡される: xtermの`buffer.active.cursorX`を使用
- プロンプトは必ず新しい行から開始: カーソルがX=0でない場合、自動的に改行を挿入
- すべての出力は単一のドライバーを通る: 出力の整合性が保証される

### 新しいアーキテクチャ

処理フロー:

```
[Command Output] ──┐
[User Input]     ──┼─→ [TerminalOutputManager] ──→ [Write Queue] ──→ [Normalization] ──→ [xterm.js]
[System Messages]──┤            ↓
[Vim Mode]       ──┘    [Cursor Tracking] ──→ [ensureNewline]
```

## 実装の詳細

### TerminalOutputManager

**責務**:
1. すべてのターミナル出力の一元管理
2. カーソル位置の自動追跡
3. 改行の自動正規化
4. 非同期出力のキュー管理

**主要メソッド**:

```typescript
class TerminalOutputManager {
  // 基本出力 - 改行を自動で \r\n に変換
  write(text: string): Promise<void>
  
  // 改行付き出力
  writeln(text: string): Promise<void>
  
  // 生の出力 (ANSIシーケンス用)
  writeRaw(data: string): Promise<void>
  
  // プロンプト前の改行保証 - これが核心機能
  ensureNewline(): Promise<void>
  
  // カーソル状態の取得
  getCursorState(): { atLineStart: boolean; x: number; y: number }
}
```

### カーソル位置追跡の仕組み

```typescript
private isAtLineStart(): boolean {
  try {
    // xterm.jsのバッファーから直接カーソルX座標を取得
    return this.term.buffer.active.cursorX === 0;
  } catch {
    // フォールバック: 最後の出力が\nで終わったかで判断
    return this.lastWriteEndedWithNewline;
  }
}
```

**なぜこれが機能するか**:
- `cursorX === 0`: カーソルが行頭にある = 新しい行の開始
- バッファーアクセス失敗時のフォールバック機能付き
- Linux/Windowsターミナルの標準動作を模倣

### ensureNewline() - 核心ロジック

```typescript
async ensureNewline(): Promise<void> {
  if (!this.isAtLineStart()) {
    await this.write('\n');
  }
}
```

**動作**:
1. プロンプト表示前に必ず呼ばれる
2. カーソルが行頭でなければ改行を挿入
3. これにより、コマンド出力が改行で終わらなくても、プロンプトは新しい行に表示される

**実例**:

```
# コマンド出力が改行なしで終わる場合
$ echo -n "hello"
hello$ ← 重なる (以前)

↓ ensureNewline()適用後

$ echo -n "hello"
hello
$ ← 新しい行 (修正後)
```

### 改行の正規化

```typescript
private normalizeLineEndings(text: string): string {
  return text.replace(/\r?\n/g, '\r\n');
}
```

**理由**:
- Unix系: `\n` (LF)
- Windows: `\r\n` (CRLF)
- xterm.js: `\r\n` を要求

すべての `\n` を `\r\n` に統一することで、プラットフォーム間の互換性を確保

### 非同期キュー管理

```typescript
private writeQueue: Array<{ data: string; callback?: () => void }> = [];
private isWriting = false;

private flushQueue(): void {
  if (this.isWriting || this.writeQueue.length === 0) return;
  
  this.isWriting = true;
  const { data, callback } = this.writeQueue.shift()!;
  
  this.term.write(data, () => {
    this.isWriting = false;
    if (callback) callback();
    this.flushQueue(); // 次の項目を処理
  });
}
```

**利点**:
- レースコンディションの防止
- 出力の順序保証
- 非同期処理の完了通知

## Terminal.tsxの統合

### 変更点

**以前**:
```typescript
// 複数の経路で直接書き込み
term.write(output);
term.writeln(message);
// 手動の状態管理
let atLineStart = true;
```

**修正後**:
```typescript
// 単一の経路で出力
const outputManager = new TerminalOutputManager(term);
await outputManager.write(output);
await outputManager.writeln(message);
// 自動的な状態追跡
await outputManager.ensureNewline(); // プロンプト前
```

### showPrompt関数の改善

```typescript
const showPrompt = async () => {
  // 核心: プロンプト前に必ず新しい行を確保
  await outputManager.ensureNewline();
  
  // プロンプト表示
  await outputManager.writeRaw(`/workspaces/${currentProject}... $ `);
  scrollToBottom();
};
```

## 設計の利点

### 1. 単一責任原則
- **TerminalOutputManager**: 出力管理のみに特化
- **Terminal.tsx**: UI・入力処理に集中

### 2. 保守性
- 改行処理のロジックが一箇所に集約
- 変更時の影響範囲が明確
- テストが容易

### 3. 拡張性
```typescript
// 新しい出力タイプの追加が容易
async writeColored(text: string, color: string): Promise<void> {
  await this.write(`\x1b[${color}m${text}\x1b[0m`);
}
```

### 4. 一貫性
- すべての出力が同じルールに従う
- プラットフォーム間の動作が統一される
- Linux/Windows/macOSで同じ体験

## パフォーマンス考慮

### バッファリング
```typescript
// 複数の小さい書き込みを一つにまとめる
await outputManager.write('a');
await outputManager.write('b');
await outputManager.write('c');
↓
内部でキューに追加し、順次処理
```

### カーソル位置の取得コスト
```typescript
// O(1) - xterm.jsの内部バッファーから直接取得
this.term.buffer.active.cursorX
```

## テストシナリオ

### 1. 改行なし出力
```bash
$ echo -n "test"
test
$ ← 新しい行
```

### 2. 複数行出力
```bash
$ ls
file1.txt
file2.txt
$ ← 新しい行
```

### 3. リアルタイム出力 (npm install等)
```bash
$ npm install
⠋ Installing packages...
✓ Done
$ ← 新しい行
```

## まとめ

この設計により：

1. **問題の根本解決**: 手動状態管理の廃止
2. **Linux/Windows標準準拠**: カーソル位置ベースの判断
3. **管理しやすい構造**: 単一責任・明確な責務分離
4. **高度な実装**: 非同期キュー・エラーハンドリング完備

**参考にした実装**:
- Linux tty driver
- xterm terminal emulator
- Windows Console API
- GNU readline library

この設計は、本物のターミナルエミュレータの動作原理に基づいた、体系的で高度な実装です。
