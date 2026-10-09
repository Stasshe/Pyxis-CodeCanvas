import type { IBuffer, IBufferCell, IMarker } from '@xterm/xterm';
import type { UnicodeTerminal } from '@/engine/system/terminal/unicodeTerminal';
import type { LineState } from '../../engine/system/terminal/lineEditor';

export type LineTerminal = Pick<
  UnicodeTerminal,
  'cols' | 'rows' | 'buffer' | 'registerMarker' | 'write' | 'cellWidth'
>;

export interface LineAnchor {
  marker: IMarker;
  buffer: IBuffer;
  prompt: string;
  pending: Promise<void>;
  disposed: boolean;
  isCurrent: () => boolean;
}

const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function write(term: LineTerminal, text: string): Promise<void> {
  return new Promise(resolve => term.write(text, resolve));
}

function cellStyle(cell: IBufferCell): string {
  const attributes = [0];
  const styles: Array<[number, number]> = [
    [cell.isBold(), 1],
    [cell.isDim(), 2],
    [cell.isItalic(), 3],
    [cell.isUnderline(), 4],
    [cell.isBlink(), 5],
    [cell.isInverse(), 7],
    [cell.isInvisible(), 8],
    [cell.isStrikethrough(), 9],
    [cell.isOverline(), 53],
  ];
  for (const [enabled, code] of styles) {
    if (enabled) attributes.push(code);
  }
  const colors: Array<[boolean, boolean, number, number]> = [
    [cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor(), 38],
    [cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor(), 48],
  ];
  for (const [rgb, palette, color, code] of colors) {
    if (rgb) attributes.push(code, 2, (color >> 16) & 255, (color >> 8) & 255, color & 255);
    else if (palette) attributes.push(code, 5, color);
  }
  return `\x1b[${attributes.join(';')}m`;
}

/** Capture only after the prompt's write callback has completed. */
export function captureLineAnchor(
  term: LineTerminal,
  isCurrent: () => boolean = () => true
): LineAnchor {
  const buffer = term.buffer.active;
  const endRow = buffer.baseY + buffer.cursorY;
  let startRow = endRow;
  while (startRow > 0 && buffer.getLine(startRow)?.isWrapped) startRow -= 1;
  let prompt = '';
  for (let row = startRow; row <= endRow; row += 1) {
    const line = buffer.getLine(row);
    if (!line) throw new Error('Prompt buffer line is unavailable');
    let endColumn = Math.min(line.length, term.cols);
    if (row === endRow) endColumn = buffer.cursorX;
    for (let column = 0; column < endColumn; column += 1) {
      const cell = line.getCell(column);
      if (!cell || cell.getWidth() === 0) continue;
      const chars = cell.getChars();
      // An empty final cell before a wide glyph is wrap padding, not prompt text.
      if (!chars && column === term.cols - 1 && row < endRow) continue;
      prompt += cellStyle(cell) + (chars || ' ');
    }
  }
  prompt += '\x1b[0m';
  const marker = term.registerMarker(startRow - endRow);
  if (!marker) throw new Error('Cannot register prompt marker');
  return { marker, buffer, prompt, pending: Promise.resolve(), disposed: false, isCurrent };
}

function isAnchorActive(term: LineTerminal, anchor: LineAnchor): boolean {
  if (anchor.disposed || !anchor.isCurrent()) {
    disposeLineAnchor(anchor);
    return false;
  }
  if (anchor.buffer === term.buffer.active) return true;
  disposeLineAnchor(anchor);
  return false;
}

function move(term: LineTerminal, row: number, column: number): string {
  const delta = row - term.buffer.active.cursorY;
  let vertical = '';
  if (delta < 0) vertical = `\x1b[${-delta}A`;
  if (delta > 0) vertical = `\x1b[${delta}B`;
  return `${vertical}\x1b[${column + 1}G`;
}

async function resetLine(
  term: LineTerminal,
  anchor: LineAnchor,
  preserveOutput = true
): Promise<void> {
  const active = term.buffer.active;
  const outsideViewport = anchor.marker.isDisposed || anchor.marker.line < active.baseY;
  if (preserveOutput && outsideViewport) {
    anchor.marker.dispose();
    const row = active.getLine(active.baseY + active.cursorY);
    let rowHasText = false;
    for (let column = 0; column < term.cols; column += 1) {
      if (row?.getCell(column)?.getChars()) {
        rowHasText = true;
        break;
      }
    }
    if (active.cursorX !== 0 || rowHasText) await write(term, '\r\n');
    const marker = term.registerMarker();
    if (!marker) throw new Error('Cannot register prompt marker after output');
    anchor.marker = marker;
    await write(term, anchor.prompt);
    if (!isAnchorActive(term, anchor)) return;
    return;
  }
  let row = anchor.marker.line - active.baseY;
  // Input longer than the screen has a cropped editable view. The logical text
  // stays in LineState; a fresh prompt starts at the visible top when necessary.
  if (anchor.marker.isDisposed || row < 0) row = 0;
  anchor.marker.dispose();
  await write(term, `${move(term, row, 0)}\x1b[J`);
  if (!isAnchorActive(term, anchor)) return;
  const marker = term.registerMarker();
  if (!marker) throw new Error('Cannot register editable line marker');
  anchor.marker = marker;
  await write(term, anchor.prompt);
  if (!isAnchorActive(term, anchor)) return;
}

async function finishPrefix(term: LineTerminal, prefix: string): Promise<void> {
  await write(term, prefix);
  if (term.buffer.active.cursorX === term.cols) {
    // Materialize pending autowrap; CUP cannot represent the sentinel column.
    await write(term, ' \x1b[1D\x1b[K');
  }
}

function suffixFitsViewport(term: LineTerminal, suffix: string): boolean {
  const buffer = term.buffer.active;
  let row = buffer.cursorY;
  let column = buffer.cursorX;
  for (const { segment } of graphemeSegmenter.segment(suffix)) {
    if (column === term.cols) {
      row += 1;
      column = 0;
    }
    let width = term.cellWidth(segment);
    if (segment === '\t') {
      const nextTabStop = Math.min((Math.floor(column / 8) + 1) * 8, term.cols - 1);
      width = nextTabStop - column;
    }
    if (width === 2 && column === term.cols - 1) {
      row += 1;
      column = 0;
    }
    if (row >= term.rows || width > term.cols) return false;
    column += width;
  }
  return true;
}

async function draw(term: LineTerminal, anchor: LineAnchor, state: LineState): Promise<void> {
  if (!isAnchorActive(term, anchor)) return;
  await resetLine(term, anchor);
  if (!isAnchorActive(term, anchor)) return;
  const prefix = state.text.slice(0, state.cursor);
  const suffix = state.text.slice(state.cursor);
  await finishPrefix(term, prefix);
  if (!isAnchorActive(term, anchor)) return;
  const column = term.buffer.active.cursorX;
  const cursorMarker = term.registerMarker();
  if (!cursorMarker) throw new Error('Cannot register input cursor marker');
  try {
    let visibleSuffix = suffix;
    if (!suffixFitsViewport(term, suffix)) visibleSuffix = '';
    await write(term, visibleSuffix);
    if (!isAnchorActive(term, anchor)) return;
    let row = cursorMarker.line - term.buffer.active.baseY;
    if (cursorMarker.isDisposed || row < 0) {
      // Drawing the suffix scrolled the editing point away. Keep the prefix
      // visible and retain the undisplayed suffix in the caller's text state.
      await resetLine(term, anchor, false);
      if (!isAnchorActive(term, anchor)) return;
      await finishPrefix(term, prefix);
      return;
    }
    let cursorColumn = column;
    const buffer = term.buffer.active;
    const cell = buffer.getLine(cursorMarker.line)?.getCell(column);
    const following = buffer.getLine(cursorMarker.line + 1);
    const first = following?.getCell(0);
    if (
      column === term.cols - 1 &&
      !cell?.getChars() &&
      following?.isWrapped &&
      first?.getWidth() === 2 &&
      suffix.length > 0 &&
      first.getChars().startsWith(Array.from(suffix)[0])
    ) {
      row += 1;
      cursorColumn = 0;
    }
    await write(term, move(term, row, cursorColumn));
  } finally {
    cursorMarker.dispose();
    if (anchor.disposed) anchor.marker.dispose();
  }
}

export function renderLine(
  term: LineTerminal,
  anchor: LineAnchor,
  nextState: LineState
): Promise<void> {
  const state = { ...nextState };
  const next = anchor.pending.then(() => draw(term, anchor, state));
  anchor.pending = next;
  return next;
}

export function disposeLineAnchor(anchor: LineAnchor): void {
  anchor.disposed = true;
  anchor.marker.dispose();
}
