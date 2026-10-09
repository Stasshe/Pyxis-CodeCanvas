// 差分表示ユーティリティ（diffライブラリ利用）
import { diffLines } from 'diff';

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNumber?: number;
  newLineNumber?: number;
  content: string;
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
        result.push({
          type: 'unchanged',
          oldLineNumber: oldLine,
          newLineNumber: newLine,
          content: line,
        });
        oldLine++;
        newLine++;
      }
    }
  }
  return result;
}
