
// 差分表示ユーティリティ（diffライブラリ利用）
import { diffLines, diffWords } from 'diff';

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
}

export interface DiffBlock {
  type: 'unchanged' | 'changed';
  lines: DiffLine[];
  startLine: number;
  endLine: number;
}

// 行ベースの差分計算（diffライブラリ利用）
export function calculateDiff(oldText: string, newText: string): DiffLine[] {
  const diff = diffLines(oldText, newText);
  const result: DiffLine[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (const part of diff) {
    const lines = part.value.split('\n');
    // diffLinesは最後に空文字列が入ることがあるので除外
    const filteredLines = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
    for (const line of filteredLines) {
      if (part.added) {
        result.push({ type: 'added', newLineNumber: newLine, content: line });
        newLine++;
      } else if (part.removed) {
        result.push({ type: 'removed', oldLineNumber: oldLine, content: line });
        oldLine++;
      } else {
        result.push({ type: 'unchanged', oldLineNumber: oldLine, newLineNumber: newLine, content: line });
        oldLine++;
        newLine++;
      }
    }
  }
  return result;
}

// 差分行を変更ブロックにグループ化
export function groupDiffLines(diffLines: DiffLine[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let currentBlock: DiffLine[] = [];
  let currentType: 'unchanged' | 'changed' = 'unchanged';
  let startLine = 1;

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    const lineType = line.type === 'unchanged' ? 'unchanged' : 'changed';

    if (lineType !== currentType) {
      // ブロックが変わる
      if (currentBlock.length > 0) {
        blocks.push({
          type: currentType,
          lines: [...currentBlock],
          startLine,
          endLine: startLine + currentBlock.length - 1
        });
      }
      currentBlock = [line];
      currentType = lineType;
      startLine = line.oldLineNumber || line.newLineNumber || startLine;
    } else {
      currentBlock.push(line);
    }
  }

  // 最後のブロックを追加
  if (currentBlock.length > 0) {
    blocks.push({
      type: currentType,
      lines: currentBlock,
      startLine,
      endLine: startLine + currentBlock.length - 1
    });
  }

  return blocks;
}

// 文字レベルでの差分計算（diffライブラリ利用）
export function calculateWordDiff(oldLine: string, newLine: string): {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
}[] {
  const diff = diffWords(oldLine, newLine);
  const result: { type: 'unchanged' | 'added' | 'removed'; content: string }[] = [];
  for (const part of diff) {
    if (part.added) {
      result.push({ type: 'added', content: part.value });
    } else if (part.removed) {
      result.push({ type: 'removed', content: part.value });
    } else {
      result.push({ type: 'unchanged', content: part.value });
    }
  }
  return result;
}
