import { createPatterns, type PatternDef, type Token, type TokenType } from './inlineCodePatterns';

// Helper function to parse a double-quoted string in shell
// Handles nested $(), ${}, and escaped characters correctly
const parseShellDoubleQuotedString = (code: string, startIndex: number): string => {
  let j = startIndex + 1; // skip opening "
  let result = '"';

  while (j < code.length) {
    const char = code[j];

    if (char === '"') {
      return `${result}"`;
    }

    if (char === '\\' && j + 1 < code.length) {
      result += code.slice(j, j + 2);
      j += 2;
      continue;
    }

    if (char === '$' && j + 1 < code.length && code[j + 1] === '(') {
      const sub = parseShellCommandSubstitution(code, j);
      result += sub;
      j += sub.length;
      continue;
    }

    if (char === '`') {
      // Find matching backtick, handling escape sequences
      let endIndex = j + 1;
      while (endIndex < code.length) {
        if (code[endIndex] === '`') {
          break;
        }
        if (code[endIndex] === '\\' && endIndex + 1 < code.length) {
          endIndex += 2;
          continue;
        }
        endIndex++;
      }
      if (endIndex < code.length) {
        result += code.slice(j, endIndex + 1);
        j = endIndex + 1;
        continue;
      }
      // Unclosed backtick - just include the rest and move to end
      result += code.slice(j);
      break;
    }

    result += char;
    j++;
  }

  return result;
};

// Helper function to parse command substitution $() in shell
// Handles nested parentheses and quoted strings correctly
const parseShellCommandSubstitution = (code: string, startIndex: number): string => {
  let depth = 0;
  let j = startIndex;

  while (j < code.length) {
    const char = code[j];

    if (char === '$' && j + 1 < code.length && code[j + 1] === '(') {
      depth++;
      j += 2;
      continue;
    }

    if (char === '(') {
      depth++;
      j++;
      continue;
    }

    if (char === ')') {
      depth--;
      if (depth === 0) {
        return code.slice(startIndex, j + 1);
      }
      j++;
      continue;
    }

    if (char === '"') {
      const str = parseShellDoubleQuotedString(code, j);
      j += str.length;
      continue;
    }

    // In bash, single quotes don't support escape sequences - they are literal
    // The string ends at the next single quote (no escaping possible)
    if (char === "'") {
      const end = code.indexOf("'", j + 1);
      if (end !== -1) {
        j = end + 1;
        continue;
      }
    }

    if (char === '\\' && j + 1 < code.length) {
      j += 2;
      continue;
    }

    j++;
  }

  return code.slice(startIndex, j);
};

// Specialized tokenizer for shell/bash that handles quotes correctly
const tokenizeShell = (code: string, patterns: PatternDef[]): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const rest = code.slice(i);

    // Double quoted string - use special parser
    if (char === '"') {
      const str = parseShellDoubleQuotedString(code, i);
      tokens.push({ type: 'string', value: str });
      i += str.length;
      continue;
    }

    // $"..." localized string
    if (rest.startsWith('$"')) {
      const str = parseShellDoubleQuotedString(code, i + 1);
      tokens.push({ type: 'templateString', value: `$${str}` });
      i += 1 + str.length;
      continue;
    }

    // Command substitution $() - use special parser
    if (rest.startsWith('$(')) {
      const sub = parseShellCommandSubstitution(code, i);
      tokens.push({ type: 'method', value: sub });
      i += sub.length;
      continue;
    }

    // Use pattern-based matching for other tokens
    let matched = false;
    for (const pattern of patterns) {
      const match = rest.match(pattern.regex);
      if (match) {
        tokens.push({ type: pattern.type, value: match[0] });
        i += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: 'text', value: char });
      i++;
    }
  }

  return tokens;
};

// Helper function to parse JS/TS template literal with ${} interpolation
// Handles nested template literals correctly
const parseJsTemplateString = (code: string, startIndex: number): string => {
  let j = startIndex + 1; // skip opening `
  let result = '`';

  while (j < code.length) {
    const char = code[j];

    if (char === '`') {
      return `${result}\``;
    }

    if (char === '\\' && j + 1 < code.length) {
      result += code.slice(j, j + 2);
      j += 2;
      continue;
    }

    // Handle ${...} interpolation with nested braces and template literals
    if (char === '$' && j + 1 < code.length && code[j + 1] === '{') {
      const expr = parseJsTemplateExpression(code, j);
      result += expr;
      j += expr.length;
      continue;
    }

    result += char;
    j++;
  }

  return result;
};

// Helper function to parse ${...} expression in JS template literals
// Handles nested braces, strings, and template literals correctly
const parseJsTemplateExpression = (code: string, startIndex: number): string => {
  let depth = 0;
  let j = startIndex;

  while (j < code.length) {
    const char = code[j];

    if (char === '$' && j + 1 < code.length && code[j + 1] === '{') {
      depth++;
      j += 2;
      continue;
    }

    if (char === '{') {
      depth++;
      j++;
      continue;
    }

    if (char === '}') {
      depth--;
      if (depth === 0) {
        return code.slice(startIndex, j + 1);
      }
      j++;
      continue;
    }

    // Handle nested template literals
    if (char === '`') {
      const str = parseJsTemplateString(code, j);
      j += str.length;
      continue;
    }

    // Handle strings
    if (char === '"') {
      let endIndex = j + 1;
      while (endIndex < code.length) {
        if (code[endIndex] === '"') {
          break;
        }
        if (code[endIndex] === '\\' && endIndex + 1 < code.length) {
          endIndex += 2;
          continue;
        }
        endIndex++;
      }
      // Ensure j doesn't go out of bounds
      j = Math.min(endIndex + 1, code.length);
      continue;
    }

    if (char === "'") {
      let endIndex = j + 1;
      while (endIndex < code.length) {
        if (code[endIndex] === "'") {
          break;
        }
        if (code[endIndex] === '\\' && endIndex + 1 < code.length) {
          endIndex += 2;
          continue;
        }
        endIndex++;
      }
      // Ensure j doesn't go out of bounds
      j = Math.min(endIndex + 1, code.length);
      continue;
    }

    if (char === '\\' && j + 1 < code.length) {
      j += 2;
      continue;
    }

    j++;
  }

  return code.slice(startIndex, j);
};

// Specialized tokenizer for JavaScript/TypeScript that handles template literals correctly
const tokenizeJsTs = (code: string, patterns: PatternDef[]): Token[] => {
  const tokens: Token[] = [];
  let i = 0;

  while (i < code.length) {
    const char = code[i];
    const rest = code.slice(i);

    // Template literal - use special parser
    if (char === '`') {
      const str = parseJsTemplateString(code, i);
      tokens.push({ type: 'templateString', value: str });
      i += str.length;
      continue;
    }

    // Use pattern-based matching for other tokens
    let matched = false;
    for (const pattern of patterns) {
      const match = rest.match(pattern.regex);
      if (match) {
        tokens.push({ type: pattern.type, value: match[0] });
        i += match[0].length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      tokens.push({ type: 'text', value: char });
      i++;
    }
  }

  return tokens;
};

// Tokenizer function
const tokenize = (code: string, patterns: PatternDef[], lang?: string): Token[] => {
  // Use specialized tokenizer based on language
  const normalizedLang = (lang || '').toLowerCase();

  // Shell/Bash languages
  if (['bash', 'sh', 'shell', 'zsh', 'fish'].includes(normalizedLang)) {
    return tokenizeShell(code, patterns);
  }

  // JavaScript/TypeScript languages
  if (
    ['javascript', 'js', 'typescript', 'ts', 'tsx', 'jsx', 'mjs', 'cjs', 'mts', 'cts'].includes(
      normalizedLang
    )
  ) {
    return tokenizeJsTs(code, patterns);
  }

  const tokens: Token[] = [];
  let remaining = code;

  while (remaining.length > 0) {
    let matched = false;
    for (const pattern of patterns) {
      const match = remaining.match(pattern.regex);
      if (match) {
        tokens.push({ type: pattern.type, value: match[0] });
        remaining = remaining.slice(match[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      tokens.push({ type: 'text', value: remaining[0] });
      remaining = remaining.slice(1);
    }
  }

  return tokens;
};

// Get token colors based on theme
const getTokenColors = (isDark: boolean) => ({
  keyword: isDark ? '#569cd6' : '#0000ff',
  controlKeyword: isDark ? '#c586c0' : '#af00db',
  storageKeyword: isDark ? '#569cd6' : '#0000ff',
  function: isDark ? '#dcdcaa' : '#795e26',
  method: isDark ? '#dcdcaa' : '#795e26',
  string: isDark ? '#ce9178' : '#a31515',
  templateString: isDark ? '#ce9178' : '#a31515',
  regex: isDark ? '#d16969' : '#811f3f',
  comment: isDark ? '#6a9955' : '#008000',
  docComment: isDark ? '#608b4e' : '#267f26',
  number: isDark ? '#b5cea8' : '#098658',
  boolean: isDark ? '#569cd6' : '#0000ff',
  null: isDark ? '#569cd6' : '#0000ff',
  operator: isDark ? '#d4d4d4' : '#333333',
  comparison: isDark ? '#d4d4d4' : '#333333',
  arrow: isDark ? '#569cd6' : '#0000ff',
  property: isDark ? '#9cdcfe' : '#001080',
  variable: isDark ? '#9cdcfe' : '#001080',
  type: isDark ? '#4ec9b0' : '#267f99',
  typeParameter: isDark ? '#4ec9b0' : '#267f99',
  class: isDark ? '#4ec9b0' : '#267f99',
  decorator: isDark ? '#dcdcaa' : '#795e26',
  attribute: isDark ? '#9cdcfe' : '#e50000',
  tag: isDark ? '#569cd6' : '#800000',
  tagBracket: isDark ? '#808080' : '#800000',
  punctuation: isDark ? '#d4d4d4' : '#000000',
  bracket: isDark ? '#ffd700' : '#795e26',
  brace: isDark ? '#da70d6' : '#af00af',
  paren: isDark ? '#179fff' : '#0431fa',
  semicolon: isDark ? '#d4d4d4' : '#000000',
  comma: isDark ? '#d4d4d4' : '#000000',
  whitespace: isDark ? '#d4d4d4' : '#000000',
  identifier: isDark ? '#9cdcfe' : '#001080',
  constant: isDark ? '#4fc1ff' : '#0070c1',
  builtin: isDark ? '#4ec9b0' : '#267f99',
  macro: isDark ? '#569cd6' : '#0000ff',
  preprocessor: isDark ? '#c586c0' : '#af00db',
  text: isDark ? '#d4d4d4' : '#000000',
});

// Get font styling for token types
const getTokenStyle = (type: TokenType): { fontWeight?: string; fontStyle?: string } => {
  switch (type) {
    case 'keyword':
    case 'controlKeyword':
    case 'storageKeyword':
      return { fontWeight: '600' };
    case 'function':
    case 'method':
      return { fontWeight: '500' };
    case 'comment':
    case 'docComment':
      return { fontStyle: 'italic' };
    case 'decorator':
      return { fontWeight: '500' };
    default:
      return {};
  }
};

export const highlightCode = (code: string, language: string, isDark: boolean): string => {
  const tokens = tokenize(code, createPatterns(language), language);
  const tokenColors = getTokenColors(isDark);
  return tokens
    .map(token => {
      const escaped = token.value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      if (token.type === 'whitespace') return escaped;
      const color = tokenColors[token.type] || tokenColors.text;
      const style = getTokenStyle(token.type);
      const fontWeight = style.fontWeight ? `font-weight:${style.fontWeight};` : '';
      const fontStyle = style.fontStyle ? `font-style:${style.fontStyle};` : '';
      return `<span style="color:${color};${fontWeight}${fontStyle}">${escaped}</span>`;
    })
    .join('');
};
