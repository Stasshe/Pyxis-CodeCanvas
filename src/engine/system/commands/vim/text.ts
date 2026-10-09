export interface Grapheme {
  value: string;
  start: number;
  end: number;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export function graphemes(text: string): Grapheme[] {
  const result: Grapheme[] = [];
  for (const item of segmenter.segment(text)) {
    result.push({
      value: item.segment,
      start: item.index,
      end: item.index + item.segment.length,
    });
  }
  return result;
}

export function isTextInput(value: string): boolean {
  return graphemes(value).length === 1 && !/[\p{Cc}\p{Zl}\p{Zp}]/u.test(value);
}

export function wordKind(character: string | undefined): 'keyword' | 'punctuation' | 'space' {
  if (!character || /\s/.test(character)) return 'space';
  if (/[\p{L}\p{M}\p{N}_]/u.test(character)) return 'keyword';
  return 'punctuation';
}

export function codePointAt(text: string, offset: number): string {
  const codePoint = text.codePointAt(offset);
  if (codePoint === undefined) return '';
  return String.fromCodePoint(codePoint);
}

export function nextCodePointOffset(text: string, offset: number): number {
  return offset + codePointAt(text, offset).length;
}

export function previousCodePointOffset(text: string, offset: number): number {
  if (offset <= 0) return 0;
  const previous = text.codePointAt(offset - 1);
  if (previous === undefined) return offset - 1;
  if (previous >= 0xdc00 && previous <= 0xdfff && offset > 1) return offset - 2;
  return offset - 1;
}

export function moveWordOffset(text: string, offset: number, direction: number): number {
  if (direction > 0) {
    const kind = wordKind(codePointAt(text, offset));
    offset = nextCodePointOffset(text, offset);
    if (kind !== 'space') {
      while (offset < text.length && wordKind(codePointAt(text, offset)) === kind)
        offset = nextCodePointOffset(text, offset);
    }
    while (offset < text.length && wordKind(codePointAt(text, offset)) === 'space')
      offset = nextCodePointOffset(text, offset);
    return offset;
  }
  offset = previousCodePointOffset(text, offset);
  while (offset > 0 && wordKind(codePointAt(text, offset)) === 'space')
    offset = previousCodePointOffset(text, offset);
  const kind = wordKind(codePointAt(text, offset));
  if (kind === 'space') return offset;
  while (offset > 0 && wordKind(codePointAt(text, previousCodePointOffset(text, offset))) === kind)
    offset = previousCodePointOffset(text, offset);
  return offset;
}

export function moveWordEndOffset(text: string, offset: number): number {
  let kind = wordKind(codePointAt(text, offset));
  const nextOffset = nextCodePointOffset(text, offset);
  if (
    kind === 'space' ||
    kind === 'punctuation' ||
    wordKind(codePointAt(text, nextOffset)) !== kind
  ) {
    offset = nextOffset;
    while (offset < text.length && wordKind(codePointAt(text, offset)) === 'space')
      offset = nextCodePointOffset(text, offset);
    kind = wordKind(codePointAt(text, offset));
  }
  while (
    offset < text.length - 1 &&
    wordKind(codePointAt(text, nextCodePointOffset(text, offset))) === kind
  )
    offset = nextCodePointOffset(text, offset);
  return offset;
}

export interface TextPosition {
  row: number;
  col: number;
}

function textOffset(lines: string[], position: TextPosition): number {
  let offset = position.col;
  for (let row = 0; row < position.row; row++) offset += (lines[row] ?? '').length + 1;
  return offset;
}

export function moveWordPosition(
  lines: string[],
  position: TextPosition,
  direction: number,
  toEnd: boolean
): TextPosition {
  const text = lines.join('\n');
  let offset = textOffset(lines, position);
  if (toEnd) offset = moveWordEndOffset(text, offset);
  else offset = moveWordOffset(text, offset, direction);
  let row = 0;
  while (row < lines.length - 1 && offset > lines[row].length) {
    offset -= lines[row].length + 1;
    row++;
  }
  return { row, col: offset };
}

interface DecodedLineEndings {
  content: string;
  lineEnding: '\n' | '\r\n';
}

export function decodeLineEndings(content: string): DecodedLineEndings {
  const usesCrLf = content.includes('\r\n') && !/(^|[^\r])\n/.test(content);
  if (!usesCrLf) return { content, lineEnding: '\n' };
  return { content: content.replace(/\r\n/g, '\n'), lineEnding: '\r\n' };
}

export function substituteLines(
  lines: string[],
  rows: number[],
  regex: RegExp,
  replacement: string
): { lines: string[]; count: number; changed: boolean } {
  let count = 0;
  let changed = false;
  const nextLines = [...lines];
  for (const row of rows) {
    const before = nextLines[row];
    const matches = before.match(regex);
    if (!matches) continue;
    if (regex.global) count += matches.length;
    else count++;
    const after = before.replace(regex, replacement);
    if (after !== before) {
      nextLines[row] = after;
      changed = true;
    }
  }
  return { lines: nextLines, count, changed };
}

export function parseSubstituteCommand(
  command: string
): { wholeFile: boolean; regex: RegExp; replacement: string } | string {
  const match = command.match(/^(%?)s\/([^/]*)\/([^/]*)(?:\/(g?))?$/);
  if (!match) return 'Invalid substitute command';
  const [, wholeFile, pattern, replacement, global] = match;
  if (!pattern) return 'Empty substitute patterns are unsupported';
  try {
    let regex: RegExp;
    if (global) regex = new RegExp(pattern, 'gu');
    else regex = new RegExp(pattern, 'u');
    return { wholeFile: Boolean(wholeFile), regex, replacement };
  } catch (error) {
    return `Invalid regex: ${errorMessage(error)}`;
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function unsupportedNormalCommandMessage(key: '"' | 'q' | '@' | 'c' | '.'): string {
  if (key === 'c') return 'Change commands are unsupported; press Esc';
  if (key === '.') return 'Repeat command is unsupported; press Esc';
  return 'Registers and macros are unsupported; press Esc';
}

export function normalizeColumn(text: string, column: number, allowEnd: boolean): number {
  const safeColumn = Math.max(0, Math.min(text.length, Math.floor(column)));
  const clusters = graphemes(text);
  if (clusters.length === 0) return 0;
  for (const cluster of clusters) {
    if (safeColumn <= cluster.start) return cluster.start;
    if (safeColumn < cluster.end) return cluster.start;
  }
  if (allowEnd) return text.length;
  return clusters[clusters.length - 1].start;
}

export function nextColumn(text: string, column: number): number {
  const current = normalizeColumn(text, column, true);
  for (const cluster of graphemes(text)) {
    if (cluster.start === current) return cluster.end;
  }
  return current;
}

export function previousColumn(text: string, column: number): number {
  const current = normalizeColumn(text, column, true);
  const clusters = graphemes(text);
  let previous = 0;
  for (const cluster of clusters) {
    if (cluster.start >= current) return previous;
    previous = cluster.start;
  }
  if (current === text.length && clusters.length > 0) {
    return clusters[clusters.length - 1].start;
  }
  return previous;
}
