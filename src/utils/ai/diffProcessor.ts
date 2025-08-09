// 差分表示ユーティリティ（独自実装）

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

// 簡単な差分計算（行ベース）
export function calculateDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: DiffLine[] = [];

  let oldIndex = 0;
  let newIndex = 0;

  // 最長共通部分列（LCS）の簡単な実装
  while (oldIndex < oldLines.length || newIndex < newLines.length) {
    if (oldIndex >= oldLines.length) {
      // 残りは全て追加
      result.push({
        type: 'added',
        newLineNumber: newIndex + 1,
        content: newLines[newIndex]
      });
      newIndex++;
    } else if (newIndex >= newLines.length) {
      // 残りは全て削除
      result.push({
        type: 'removed',
        oldLineNumber: oldIndex + 1,
        content: oldLines[oldIndex]
      });
      oldIndex++;
    } else if (oldLines[oldIndex] === newLines[newIndex]) {
      // 同じ行
      result.push({
        type: 'unchanged',
        oldLineNumber: oldIndex + 1,
        newLineNumber: newIndex + 1,
        content: oldLines[oldIndex]
      });
      oldIndex++;
      newIndex++;
    } else {
      // 異なる行 - 先読みして共通行を探す
      let foundMatch = false;
      
      // 小さな範囲で共通行を探す
      for (let ahead = 1; ahead <= 5; ahead++) {
        if (oldIndex + ahead < oldLines.length && 
            newIndex + ahead < newLines.length &&
            oldLines[oldIndex + ahead] === newLines[newIndex + ahead]) {
          // 共通行が見つかった
          
          // 見つかるまでの行を変更として扱う
          for (let i = 0; i < ahead; i++) {
            result.push({
              type: 'removed',
              oldLineNumber: oldIndex + i + 1,
              content: oldLines[oldIndex + i]
            });
          }
          for (let i = 0; i < ahead; i++) {
            result.push({
              type: 'added',
              newLineNumber: newIndex + i + 1,
              content: newLines[newIndex + i]
            });
          }
          
          oldIndex += ahead;
          newIndex += ahead;
          foundMatch = true;
          break;
        }
      }
      
      if (!foundMatch) {
        // 単純に1行ずつ変更として処理
        result.push({
          type: 'removed',
          oldLineNumber: oldIndex + 1,
          content: oldLines[oldIndex]
        });
        result.push({
          type: 'added',
          newLineNumber: newIndex + 1,
          content: newLines[newIndex]
        });
        oldIndex++;
        newIndex++;
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

// 文字レベルでの差分計算（簡易版）
export function calculateWordDiff(oldLine: string, newLine: string): {
  type: 'unchanged' | 'added' | 'removed';
  content: string;
}[] {
  const oldWords = oldLine.split(/(\s+)/);
  const newWords = newLine.split(/(\s+)/);
  const result: { type: 'unchanged' | 'added' | 'removed'; content: string }[] = [];

  let oldIndex = 0;
  let newIndex = 0;

  while (oldIndex < oldWords.length || newIndex < newWords.length) {
    if (oldIndex >= oldWords.length) {
      result.push({ type: 'added', content: newWords[newIndex] });
      newIndex++;
    } else if (newIndex >= newWords.length) {
      result.push({ type: 'removed', content: oldWords[oldIndex] });
      oldIndex++;
    } else if (oldWords[oldIndex] === newWords[newIndex]) {
      result.push({ type: 'unchanged', content: oldWords[oldIndex] });
      oldIndex++;
      newIndex++;
    } else {
      result.push({ type: 'removed', content: oldWords[oldIndex] });
      result.push({ type: 'added', content: newWords[newIndex] });
      oldIndex++;
      newIndex++;
    }
  }

  return result;
}
