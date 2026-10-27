export interface LineState {
  text: string;
  cursor: number;
}

export function isPrintableLineInput(data: string): boolean {
  return (
    data.length > 0 &&
    Array.from(data).every(character => {
      const code = character.codePointAt(0) ?? 0;
      return code > 31 && (code < 127 || code > 159);
    })
  );
}

export type LineAction =
  | 'left'
  | 'right'
  | 'home'
  | 'end'
  | 'backspace'
  | 'delete'
  | 'killStart'
  | 'killEnd'
  | 'killWord'
  | 'wordLeft'
  | 'wordRight';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const readlineWord = /^[\p{L}\p{N}\p{M}]+$/u;

function boundaries(text: string): number[] {
  const result = [0];
  for (const item of segmenter.segment(text)) {
    const end = item.index + item.segment.length;
    if (end > result[result.length - 1]) result.push(end);
  }
  return result;
}

function normalizedCursor(state: LineState, points: number[]): number {
  const cursor = Math.max(0, Math.min(state.cursor, state.text.length));
  for (let index = 0; index < points.length; index += 1) {
    if (points[index] > cursor) return points[Math.max(0, index - 1)];
  }
  return points[points.length - 1];
}

function nextBoundary(points: number[], cursor: number): number {
  for (const point of points) {
    if (point >= cursor) return point;
  }
  return points[points.length - 1];
}

function pointIndex(points: number[], cursor: number): number {
  const index = points.indexOf(cursor);
  if (index < 0) return 0;
  return index;
}

function previousWordStart(text: string, cursor: number): number {
  const points = boundaries(text);
  let index = pointIndex(points, cursor);
  while (index > 0 && /^\s+$/u.test(text.slice(points[index - 1], points[index]))) index -= 1;
  while (index > 0 && !/^\s+$/u.test(text.slice(points[index - 1], points[index]))) index -= 1;
  return points[index];
}

function previousReadlineWordStart(text: string, cursor: number): number {
  const points = boundaries(text);
  let index = pointIndex(points, cursor);
  while (index > 0 && !readlineWord.test(text.slice(points[index - 1], points[index]))) index -= 1;
  while (index > 0 && readlineWord.test(text.slice(points[index - 1], points[index]))) index -= 1;
  return points[index];
}

function nextReadlineWordEnd(text: string, cursor: number): number {
  const points = boundaries(text);
  let index = pointIndex(points, cursor);
  while (
    index < points.length - 1 &&
    !readlineWord.test(text.slice(points[index], points[index + 1]))
  )
    index += 1;
  while (
    index < points.length - 1 &&
    readlineWord.test(text.slice(points[index], points[index + 1]))
  )
    index += 1;
  return points[index];
}

export function editLine(state: LineState, action: LineAction): LineState {
  const points = boundaries(state.text);
  const cursor = normalizedCursor(state, points);
  const index = pointIndex(points, cursor);
  let nextCursor = cursor;
  let text = state.text;

  if (action === 'left') nextCursor = points[Math.max(0, index - 1)];
  if (action === 'right') nextCursor = points[Math.min(points.length - 1, index + 1)];
  if (action === 'home') nextCursor = 0;
  if (action === 'end') nextCursor = text.length;
  if (action === 'backspace' && index > 0) {
    const start = points[index - 1];
    text = text.slice(0, start) + text.slice(cursor);
    nextCursor = start;
  }
  if (action === 'delete' && index < points.length - 1) {
    text = text.slice(0, cursor) + text.slice(points[index + 1]);
  }
  if (action === 'killStart') {
    text = text.slice(cursor);
    nextCursor = 0;
  }
  if (action === 'killEnd') text = text.slice(0, cursor);
  if (action === 'killWord') {
    const start = previousWordStart(text, cursor);
    text = text.slice(0, start) + text.slice(cursor);
    nextCursor = start;
  }
  if (action === 'wordLeft') nextCursor = previousReadlineWordStart(text, cursor);
  if (action === 'wordRight') nextCursor = nextReadlineWordEnd(text, cursor);
  if (text !== state.text) nextCursor = nextBoundary(boundaries(text), nextCursor);
  return { text, cursor: nextCursor };
}

export function insertLineText(state: LineState, input: string): LineState {
  const clean = Array.from(input.replace(/\r\n|\r|\n/g, ' '))
    .filter(character => {
      const code = character.charCodeAt(0);
      return code === 9 || (code > 31 && code !== 127 && (code < 128 || code > 159));
    })
    .join('');
  const points = boundaries(state.text);
  const cursor = normalizedCursor(state, points);
  const text = state.text.slice(0, cursor) + clean + state.text.slice(cursor);
  const insertionEnd = cursor + clean.length;
  const insertedPoints = boundaries(text);
  return { text, cursor: nextBoundary(insertedPoints, insertionEnd) };
}

const actionMappings = new Map<string, LineAction>([
  ['\u0002', 'left'],
  ['\u0006', 'right'],
  ['\u0001', 'home'],
  ['\u0005', 'end'],
  ['\u0008', 'backspace'],
  ['\u007f', 'backspace'],
  ['\u0004', 'delete'],
  ['\u0015', 'killStart'],
  ['\u0017', 'killWord'],
  ['\u000b', 'killEnd'],
  ['\u001b[D', 'left'],
  ['\u001b[C', 'right'],
  ['\u001b[1;5D', 'wordLeft'],
  ['\u001b[1;5C', 'wordRight'],
  ['\u001b[H', 'home'],
  ['\u001b[F', 'end'],
  ['\u001bOH', 'home'],
  ['\u001bOF', 'end'],
  ['\u001b[1~', 'home'],
  ['\u001b[4~', 'end'],
  ['\u001b[7~', 'home'],
  ['\u001b[8~', 'end'],
  ['\u001b[3~', 'delete'],
]);

export function lineAction(data: string): LineAction | undefined {
  return actionMappings.get(data);
}
