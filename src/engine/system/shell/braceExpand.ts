// Brace expansion utility
// Supports nested braces, comma-separated lists, and numeric ranges with optional zero-padding.
// Examples:
//  - a{b,c}d -> abd, acd
//  - {1..3} -> 1,2,3
//  - {03..05} -> 03,04,05
//  - x{a,{b,c}}y -> xay, xby, xcy

const splitTopLevelCommas = (s: string): string[] => {
  const out: string[] = [];
  let cur = '';
  let depth = 0;
  let quote = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      cur += ch + (s[++i] ?? '');
      continue;
    }
    if (ch === quote) {
      quote = '';
      cur += ch;
      continue;
    }
    if (quote === '' && (ch === "'" || ch === '"')) {
      quote = ch;
      cur += ch;
      continue;
    }
    if (quote) {
      cur += ch;
      continue;
    }
    if (ch === '{') {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === '}') {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === ',' && depth === 0) {
      out.push(cur);
      cur = '';
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out;
};

const expandNumericRange = (s: string): string[] | null => {
  const m = s.match(/^(-?\d+)\.\.(-?\d+)$/);
  if (!m) return null;
  const a = Number.parseInt(m[1], 10);
  const b = Number.parseInt(m[2], 10);
  const width = Math.max(m[1].length, m[2].length);
  const padded = /^-?0\d/.test(m[1]) || /^-?0\d/.test(m[2]);
  const format = (value: number) => {
    if (!padded) return String(value);
    if (value < 0) return `-${String(-value).padStart(width - 1, '0')}`;
    return String(value).padStart(width, '0');
  };
  const out: string[] = [];
  if (a <= b) {
    for (let v = a; v <= b; v++) out.push(format(v));
  } else {
    for (let v = a; v >= b; v--) out.push(format(v));
  }
  return out;
};

export default function expandBraces(input: string): string[] {
  // Fast path: no braces
  if (!input.includes('{')) return [input];

  let quote = '';
  let firstOpen = -1;
  let matchClose = -1;
  for (let index = 0; index < input.length; index++) {
    const character = input[index];
    if (character === '\\') {
      index++;
      continue;
    }
    if (character === quote) {
      quote = '';
      continue;
    }
    if (quote === '' && (character === "'" || character === '"')) {
      quote = character;
      continue;
    }
    if (quote || character !== '{') continue;
    let depth = 1;
    let end = index + 1;
    let innerQuote = '';
    while (end < input.length && depth > 0) {
      const ch = input[end];
      if (ch === '\\') {
        end += 2;
        continue;
      }
      if (ch === innerQuote) {
        innerQuote = '';
        end++;
        continue;
      }
      if (innerQuote === '' && (ch === "'" || ch === '"')) {
        innerQuote = ch;
        end++;
        continue;
      }
      if (!innerQuote) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      end++;
    }
    if (depth > 0) continue;
    if (input[index - 1] === '$') {
      index = end - 1;
      continue;
    }
    const inner = input.slice(index + 1, end - 1);
    if (expandNumericRange(inner) !== null || splitTopLevelCommas(inner).length > 1) {
      firstOpen = index;
      matchClose = end - 1;
      break;
    }
  }
  if (firstOpen === -1) return [input];

  const prefix = input.slice(0, firstOpen);
  const inner = input.slice(firstOpen + 1, matchClose);
  const suffix = input.slice(matchClose + 1);

  // If inner is a simple numeric range like 1..5, expand it as the set
  const numRange = expandNumericRange(inner);
  const parts = numRange ?? splitTopLevelCommas(inner);

  const results: string[] = [];
  for (const part of parts) {
    // recursively expand the part (it may contain nested braces)
    const leftExpansions = expandBraces(part);
    // recursively expand the suffix as well
    const rightExpansions = expandBraces(suffix);
    for (const l of leftExpansions) {
      for (const r of rightExpansions) {
        results.push(prefix + l + r);
      }
    }
  }

  return results;
}
