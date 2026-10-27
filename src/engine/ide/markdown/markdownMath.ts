type MathDelimiter = 'dollar' | 'bracket' | 'both';

interface Fence {
  marker: '`' | '~';
  length: number;
}

const getOpeningFence = (line: string): Fence | null => {
  const match = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  if (!match) return null;

  const marker = match[1][0] as Fence['marker'];
  if (marker === '`' && match[2].includes('`')) return null;
  return { marker, length: match[1].length };
};

const isClosingFence = (line: string, fence: Fence): boolean => {
  const match = /^ {0,3}(`+|~+)[ \t]*$/.exec(line);
  return Boolean(match && match[1][0] === fence.marker && match[1].length >= fence.length);
};

const processOutsideInlineCode = (
  source: string,
  processText: (text: string) => string
): string => {
  let result = '';
  let plainText = '';
  let index = 0;

  while (index < source.length) {
    if (source[index] !== '`') {
      plainText += source[index];
      index += 1;
      continue;
    }

    let openingEnd = index + 1;
    while (source[openingEnd] === '`') openingEnd += 1;
    const openingLength = openingEnd - index;
    let closingStart = source.indexOf('`', openingEnd);
    let closingEnd = -1;

    while (closingStart !== -1) {
      let runEnd = closingStart + 1;
      while (source[runEnd] === '`') runEnd += 1;
      if (runEnd - closingStart === openingLength) {
        closingEnd = runEnd;
        break;
      }
      closingStart = source.indexOf('`', runEnd);
    }

    if (closingEnd === -1) {
      plainText += source.slice(index, openingEnd);
      index = openingEnd;
      continue;
    }

    result += processText(plainText);
    plainText = '';
    result += source.slice(index, closingEnd);
    index = closingEnd;
  }

  return result + processText(plainText);
};

const processOutsideCodeBlocks = (
  source: string,
  processText: (text: string) => string
): string => {
  const parts = source.split(/(\r\n|\n|\r)/);
  let result = '';
  let outsideCode = '';
  let fence: Fence | null = null;

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index];
    const lineWithEnding = line + (parts[index + 1] ?? '');

    if (fence) {
      result += lineWithEnding;
      if (isClosingFence(line, fence)) fence = null;
      continue;
    }

    const openingFence = getOpeningFence(line);
    if (openingFence) {
      result += processOutsideInlineCode(outsideCode, processText);
      outsideCode = '';
      result += lineWithEnding;
      fence = openingFence;
    } else {
      outsideCode += lineWithEnding;
    }
  }

  return result + processOutsideInlineCode(outsideCode, processText);
};

export function preprocessMarkdownMath(source: string, delimiter: MathDelimiter): string {
  if (delimiter === 'dollar') return source;

  return processOutsideCodeBlocks(source, text => {
    let dollarEscapedText = text;
    if (delimiter === 'bracket') dollarEscapedText = text.replace(/\$/g, '\\$');
    return dollarEscapedText
      .replace(/\\\(([\s\S]+?)\\\)/g, (_match, math: string) => `$${math}$`)
      .replace(/\\\[([\s\S]+?)\\\]/g, (_match, math: string) => `$$${math}$$`);
  });
}
