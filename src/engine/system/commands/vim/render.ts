import { graphemes } from './text';

export type VimMode = 'NORMAL' | 'INSERT' | 'VISUAL' | 'COMMAND';

export interface VimPosition {
  row: number;
  col: number;
}

export type PreferredColumn = number | 'MAXCOL';

export interface RenderFrameInput {
  lines: string[];
  cursor: VimPosition;
  topLine: number;
  leftCol: number;
  rows: number;
  cols: number;
  mode: VimMode;
  visualStart: VimPosition | null;
  fileName: string;
  modified: boolean;
  commandLine: string;
  message: string;
  cellWidth: (text: string) => number;
}

export interface RenderFrameResult {
  output: string;
  cursorRow: number;
  cursorCol: number;
  topLine: number;
  leftCol: number;
}

interface Glyph {
  text: string;
  start: number;
  end: number;
  cellStart: number;
  width: number;
}

function controlDisplay(character: string): string | null {
  const codePoint = character.codePointAt(0);
  if (codePoint === undefined) return null;
  if (codePoint < 0x20) return `^${String.fromCharCode(codePoint + 0x40)}`;
  if (codePoint === 0x7f) return '^?';
  if (codePoint >= 0x80 && codePoint <= 0x9f) {
    return `<${codePoint.toString(16).padStart(2, '0')}>`;
  }
  return null;
}

function printableGlyphs(line: string, cellWidth: (text: string) => number): Glyph[] {
  const glyphs: Glyph[] = [];
  let cell = 0;
  for (const { value: character, start, end } of graphemes(line)) {
    let text = character;
    let width: number;
    if (character === '\t') {
      width = 8 - (cell % 8);
      text = ' '.repeat(width);
    } else {
      const control = controlDisplay(character);
      if (control !== null) text = control;
      width = cellWidth(text);
    }
    glyphs.push({ text, start, end, cellStart: cell, width });
    cell += width;
  }
  return glyphs;
}

export function displayColumn(
  line: string,
  sourceOffset: number,
  cellWidth: (text: string) => number
): number {
  let cell = 0;
  for (const glyph of printableGlyphs(line, cellWidth)) {
    if (sourceOffset <= glyph.start) return cell;
    if (sourceOffset < glyph.end) return cell;
    cell = glyph.cellStart + glyph.width;
  }
  return cell;
}

export function sourceColumnAtDisplayColumn(
  line: string,
  targetCell: number,
  cellWidth: (text: string) => number,
  allowEnd: boolean
): number {
  const glyphs = printableGlyphs(line, cellWidth);
  for (const glyph of glyphs) {
    if (targetCell < glyph.cellStart + glyph.width) return glyph.start;
  }
  if (allowEnd) return line.length;
  const lastGlyph = glyphs[glyphs.length - 1];
  if (!lastGlyph) return 0;
  return lastGlyph.start;
}

export function verticalCursorPosition(
  lines: string[],
  row: number,
  delta: number,
  preferredColumn: PreferredColumn,
  cellWidth: (text: string) => number,
  allowEnd: boolean
): VimPosition {
  const targetRow = Math.max(0, Math.min(lines.length - 1, row + delta));
  const line = lines[targetRow] ?? '';
  if (preferredColumn === 'MAXCOL') {
    if (allowEnd) return { row: targetRow, col: line.length };
    const glyphs = printableGlyphs(line, cellWidth);
    const lastGlyph = glyphs[glyphs.length - 1];
    if (!lastGlyph) return { row: targetRow, col: 0 };
    return { row: targetRow, col: lastGlyph.start };
  }
  return {
    row: targetRow,
    col: sourceColumnAtDisplayColumn(line, preferredColumn, cellWidth, allowEnd),
  };
}

function visibleLine(
  line: string,
  leftCol: number,
  cols: number,
  cellWidth: (text: string) => number,
  selected: (glyph: Glyph) => boolean
): string {
  let output = '';
  let reverse = false;
  const setReverse = (enabled: boolean): void => {
    if (enabled === reverse) return;
    if (enabled) output += '\x1b[7m';
    else output += '\x1b[27m';
    reverse = enabled;
  };
  for (const glyph of printableGlyphs(line, cellWidth)) {
    const start = glyph.cellStart;
    const end = start + glyph.width;
    if (
      (glyph.width === 0 && start < leftCol) ||
      (glyph.width > 0 && end <= leftCol) ||
      start >= leftCol + cols
    ) {
      continue;
    }
    const isSelected = selected(glyph);
    setReverse(isSelected);
    if (start < leftCol || end > leftCol + cols) {
      output += ' '.repeat(Math.min(end, leftCol + cols) - Math.max(start, leftCol));
    } else {
      output += glyph.text;
    }
  }
  setReverse(false);
  return output;
}

function fitText(text: string, cols: number, cellWidth: (text: string) => number): string {
  let result = '';
  let width = 0;
  for (const { value: character } of graphemes(text)) {
    let safe = character;
    const control = controlDisplay(character);
    if (control !== null) safe = control;
    const nextWidth = cellWidth(safe);
    if (width + nextWidth > cols) break;
    result += safe;
    width += nextWidth;
  }
  return result;
}

export function renderFrame(input: RenderFrameInput): RenderFrameResult {
  const rows = Math.max(1, Math.floor(input.rows));
  const cols = Math.max(1, Math.floor(input.cols));
  const textRows = Math.max(1, rows - 2);
  let lines = input.lines;
  if (lines.length === 0) lines = [''];
  const row = Math.max(0, Math.min(lines.length - 1, input.cursor.row));
  const line = lines[row] ?? '';
  const sourceCol = Math.max(0, Math.min(line.length, input.cursor.col));
  const cursorCell = displayColumn(line, sourceCol, input.cellWidth);
  let leftCol = Math.max(0, input.leftCol);
  if (cursorCell < leftCol) leftCol = cursorCell;
  if (cursorCell >= leftCol + cols) leftCol = cursorCell - cols + 1;
  let topLine = Math.max(0, input.topLine);
  if (row < topLine) topLine = row;
  else if (row >= topLine + textRows) topLine = row - textRows + 1;
  topLine = Math.min(topLine, Math.max(0, lines.length - textRows));
  const selectionStart = input.visualStart;
  const selectionEnd = { row, col: sourceCol };
  let first: VimPosition | null = selectionStart;
  let last: VimPosition | null = selectionEnd;
  if (first && last && (first.row > last.row || (first.row === last.row && first.col > last.col))) {
    first = selectionEnd;
    last = selectionStart;
  }
  const output: string[] = ['\x1b[?25l'];
  for (let index = 0; index < textRows; index++) {
    const lineIndex = topLine + index;
    const text = lines[lineIndex];
    let content = '~';
    if (text !== undefined) {
      content = visibleLine(text, leftCol, cols, input.cellWidth, glyph => {
        if (input.mode !== 'VISUAL' || !first || !last) return false;
        if (lineIndex < first.row || lineIndex > last.row) return false;
        let from = 0;
        if (lineIndex === first.row) from = first.col;
        let to = Number.MAX_SAFE_INTEGER;
        if (lineIndex === last.row) to = last.col;
        return glyph.end > from && glyph.start <= to;
      });
    }
    output.push(`\x1b[${index + 1};1H\x1b[2K${content}`);
  }
  const statusRow = Math.min(rows, textRows + 1);
  let modifiedLabel = '';
  if (input.modified) modifiedLabel = ' [+]';
  const status = fitText(
    ` ${input.fileName}${modifiedLabel} ${row + 1},${sourceCol + 1} `,
    cols,
    input.cellWidth
  );
  output.push(
    `\x1b[${statusRow};1H\x1b[2K\x1b[7m${status}${' '.repeat(Math.max(0, cols - input.cellWidth(status)))}\x1b[0m`
  );
  const bottomRow = Math.min(rows, textRows + 2);
  let bottom = input.message || `-- ${input.mode} --`;
  if (input.mode === 'COMMAND') {
    bottom = `:${input.commandLine}`;
    if (input.commandLine.startsWith('/')) bottom = input.commandLine;
  }
  const visibleBottom = fitText(bottom, cols, input.cellWidth);
  output.push(`\x1b[${bottomRow};1H\x1b[2K${visibleBottom}`);
  let cursorRow = Math.max(1, Math.min(textRows, row - topLine + 1));
  let cursorCol = Math.max(1, Math.min(cols, cursorCell - leftCol + 1));
  if (input.mode === 'COMMAND') {
    cursorRow = bottomRow;
    cursorCol = Math.max(1, Math.min(cols, input.cellWidth(visibleBottom) + 1));
  }
  output.push(`\x1b[${cursorRow};${cursorCol}H\x1b[?25h`);
  return { output: output.join(''), cursorRow, cursorCol, topLine, leftCol };
}
