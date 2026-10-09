export type HeredocSpec = {
  delimiter: string;
  expand: boolean;
  stripTabs: boolean;
  start: number;
  end: number;
};

type QuoteState = 'single' | 'double' | null;

export function readHeredocHeader(source: string): HeredocSpec[] {
  const specs: HeredocSpec[] = [];
  let quote: QuoteState = null;
  let escaped = false;
  let index = 0;

  while (index < source.length) {
    const character = source[index];
    if (escaped) {
      escaped = false;
      index++;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      escaped = true;
      index++;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      if (quote === 'single') quote = null;
      else quote = 'single';
      index++;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      if (quote === 'double') quote = null;
      else quote = 'double';
      index++;
      continue;
    }
    if (quote !== 'single' && character === '`') {
      index = skipBacktick(source, index);
      continue;
    }
    if (quote !== 'single' && character === '$' && source[index + 1] === '(') {
      index = skipSubstitution(source, index);
      continue;
    }
    if (quote === null && character === '#' && (index === 0 || /\s/.test(source[index - 1] ?? '')))
      break;
    if (quote !== null || character !== '<' || source[index + 1] !== '<') {
      index++;
      continue;
    }

    const start = index;
    let cursor = index + 2;
    let stripTabs = false;
    if (source[cursor] === '-') {
      stripTabs = true;
      cursor++;
    } else if (source[cursor] === '<') {
      index += 3;
      continue;
    }
    while (source[cursor] === ' ' || source[cursor] === '\t') cursor++;
    const delimiter = readDelimiter(source, cursor);
    if (delimiter === null) {
      index = cursor;
      continue;
    }
    specs.push({
      delimiter: delimiter.value,
      expand: !delimiter.quoted,
      stripTabs,
      start,
      end: delimiter.end,
    });
    index = delimiter.end;
  }
  return specs;
}

export function readHeredocDocument(
  source: string,
  operatorStart: number
): { text: string; expand: boolean; end: number } | null {
  const headerStart = source.lastIndexOf('\n', operatorStart - 1) + 1;
  let headerEnd = source.indexOf('\n', operatorStart);
  if (headerEnd === -1) headerEnd = source.length;
  const specs = readHeredocHeader(source.slice(headerStart, headerEnd));
  const relativeStart = operatorStart - headerStart;
  let documentStart = headerEnd;
  if (headerEnd < source.length) documentStart++;

  for (const spec of specs) {
    const document = readDocument(source, documentStart, spec);
    if (spec.start === relativeStart) {
      return { text: document.text, expand: spec.expand, end: document.end };
    }
    documentStart = document.end;
  }
  return null;
}

function readDelimiter(
  source: string,
  start: number
): { value: string; quoted: boolean; end: number } | null {
  let value = '';
  let quote: QuoteState = null;
  let quoted = false;
  let index = start;
  let found = false;

  while (index < source.length) {
    const character = source[index];
    if (quote === null && /[\s|&;()<>]/.test(character)) break;
    if (character === "'" && quote !== 'double') {
      if (quote === 'single') quote = null;
      else quote = 'single';
      quoted = true;
      found = true;
      index++;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      if (quote === 'double') quote = null;
      else quote = 'double';
      quoted = true;
      found = true;
      index++;
      continue;
    }
    if (character === '\\' && quote !== 'single') {
      quoted = true;
      if (index + 1 < source.length) {
        const following = source[index + 1];
        if (quote !== 'double' || '$`"\\'.includes(following)) {
          value += following;
          found = true;
          index += 2;
          continue;
        }
        value += character;
        found = true;
        index++;
        continue;
      }
      index++;
      continue;
    }
    value += character;
    found = true;
    index++;
  }
  if (quote !== null || !found) return null;
  return { value, quoted, end: index };
}

function readDocument(
  source: string,
  start: number,
  spec: HeredocSpec
): { text: string; end: number } {
  let text = '';
  let cursor = start;
  while (cursor < source.length) {
    const lineEnd = source.indexOf('\n', cursor);
    const hasNewline = lineEnd !== -1;
    let end = source.length;
    if (hasNewline) end = lineEnd;
    const line = source.slice(cursor, end);
    let comparable = line;
    if (spec.stripTabs) comparable = line.replace(/^\t+/, '');
    if (comparable === spec.delimiter) {
      let next = end;
      if (hasNewline) next++;
      return { text, end: next };
    }
    let content = line;
    if (spec.stripTabs) content = line.replace(/^\t+/, '');
    text += content;
    if (hasNewline) text += '\n';
    cursor = end;
    if (hasNewline) cursor++;
  }
  return { text, end: source.length };
}

function skipBacktick(source: string, start: number): number {
  let index = start + 1;
  while (index < source.length) {
    if (source[index] === '\\' && index + 1 < source.length) {
      index += 2;
      continue;
    }
    if (source[index] === '`') return index + 1;
    index++;
  }
  return source.length;
}

function skipSubstitution(source: string, start: number): number {
  let depth = 0;
  let quote: QuoteState = null;
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === '\\' && quote !== 'single') {
      index += 2;
      continue;
    }
    if (character === "'" && quote !== 'double') {
      if (quote === 'single') quote = null;
      else quote = 'single';
      index++;
      continue;
    }
    if (character === '"' && quote !== 'single') {
      if (quote === 'double') quote = null;
      else quote = 'double';
      index++;
      continue;
    }
    if (quote === null && character === '`') {
      index = skipBacktick(source, index);
      continue;
    }
    if (quote !== 'single' && character === '$' && source[index + 1] === '(') {
      index = skipSubstitution(source, index);
      continue;
    }
    if (quote === null && character === '(') depth++;
    if (quote === null && character === ')') {
      depth--;
      if (depth === 0) return index + 1;
    }
    index++;
  }
  return source.length;
}
