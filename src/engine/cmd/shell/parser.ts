// Parser wrapper using shell-quote
// Produces Segment[] compatible with StreamShell's Segment type

import shellQuote from 'shell-quote';

export class ParseError extends Error {
  public pos: number | null;
  constructor(message: string, pos: number | null = null) {
    super(message);
    this.name = 'ParseError';
    this.pos = pos;
  }
}

export type Segment = {
  raw: string;
  tokens: string[];
  stdinFile?: string | null;
  stdoutFile?: string | null;
  append?: boolean;
  background?: boolean;
};

function normalizeWordTok(tok: any): string {
  if (typeof tok === 'string') return tok;
  if (tok && typeof tok === 'object') {
    // shell-quote may return objects for glob or expr; try common props
    if ('pattern' in tok) return String((tok as any).pattern);
    if ('op' in tok) return String((tok as any).op);
    if ('text' in tok) return String((tok as any).text);
    // fallback
    return String(tok);
  }
  return String(tok);
}

// Extract command-substitution segments and replace them with placeholders so
// shell-quote can tokenize the rest safely. We support simple backticks and
// $(...) forms (with balanced parens). Returns { line, map } where map maps
// placeholder -> inner command string.
function extractCommandSubstitutions(line: string): { line: string; map: Record<string, { cmd: string; quote: 'single' | 'double' | null }> } {
  const map: Record<string, { cmd: string; quote: 'single' | 'double' | null }> = {};
  let out = '';
  let i = 0;
  let id = 0;
  let inSingle = false;
  let inDouble = false;
  while (i < line.length) {
    const ch = line[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      out += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      out += ch;
      i++;
      continue;
    }
    if (ch === '`') {
      // backtick until next unescaped backtick
      let j = i + 1;
      let buf = '';
      while (j < line.length && line[j] !== '`') {
        buf += line[j++];
      }
      if (j >= line.length || line[j] !== '`') {
        // unterminated backtick
        throw new ParseError('Unterminated backtick command substitution', i);
      }
      const key = `__CMD_SUB_${id++}__`;
      map[key] = { cmd: buf, quote: inSingle ? 'single' : inDouble ? 'double' : null };
      out += key;
      i = j + 1;
      continue;
    }
    if (ch === '$' && line[i + 1] === '(') {
      // find matching ) with nesting
      let j = i + 2;
      let depth = 1;
      let buf = '';
      while (j < line.length && depth > 0) {
        if (line[j] === '(') {
          depth++;
          buf += line[j++];
          continue;
        }
        if (line[j] === ')') {
          depth--;
          if (depth === 0) {
            j++;
            break;
          }
          buf += ')';
          j++;
          continue;
        }
        buf += line[j++];
      }
      if (depth > 0) {
        // unterminated $( ... )
        throw new ParseError('Unterminated $(...) command substitution', i);
      }
      const key = `__CMD_SUB_${id++}__`;
      map[key] = { cmd: buf, quote: inSingle ? 'single' : inDouble ? 'double' : null };
      out += key;
      i = j;
      continue;
    }
    out += ch;
    i++;
  }
  return { line: out, map };
}

export function parseCommandLine(line: string, env: Record<string, string> = process.env as any): Segment[] {
  const extracted = extractCommandSubstitutions(line);
  // perform variable expansion on the extracted line (but respect single quotes)
  function expandVariables(input: string): string {
    let out = '';
    let i = 0;
    let inSingle = false;
    let inDouble = false;
    while (i < input.length) {
      const ch = input[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        out += ch;
        i++;
        continue;
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        out += ch;
        i++;
        continue;
      }
      if (ch === '$' && !inSingle) {
        // ${VAR}
        if (input[i + 1] === '{') {
          let j = i + 2;
          let name = '';
          while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) {
            name += input[j++];
          }
          // skip closing }
          if (input[j] === '}') j++;
          out += env[name] ?? '';
          i = j;
          continue;
        }
        // $VAR
        let j = i + 1;
        let name = '';
        while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) {
          name += input[j++];
        }
        if (name.length > 0) {
          out += env[name] ?? '';
          i = j;
          continue;
        }
        // if no name, keep literal $
        out += '$';
        i++;
        continue;
      }
      out += ch;
      i++;
    }
    return out;
  }

  const expandedLine = expandVariables(extracted.line);
  let toks: any[];
  try {
    toks = shellQuote.parse(expandedLine);
  } catch (e: any) {
    // Re-wrap shell-quote errors with ParseError including original message and
    // a hint about the original input.
    const msg = e && e.message ? e.message : String(e);
    throw new ParseError(`shell-quote parse error: ${msg}`, null);
  }
  const segs: Segment[] = [];
  let cur: Segment = { raw: '', tokens: [], stdinFile: null, stdoutFile: null, append: false, background: false };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok && typeof tok === 'object' && 'op' in tok) {
      const op = (tok as any).op;
      if (op === '|') {
        // end current segment
        cur.raw = cur.tokens.join(' ');
        segs.push(cur);
        cur = { raw: '', tokens: [], stdinFile: null, stdoutFile: null, append: false, background: false };
        continue;
      }
      if (op === '>' || op === '>>') {
        const next = toks[++i];
        const file = normalizeWordTok(next);
        cur.stdoutFile = file;
        cur.append = op === '>>';
        continue;
      }
      if (op === '<') {
        const next = toks[++i];
        const file = normalizeWordTok(next);
        cur.stdinFile = file;
        continue;
      }
      if (op === '&') {
        cur.background = true;
        continue;
      }
      if (op === ';') {
        // treat as separator: push and start new
        cur.raw = cur.tokens.join(' ');
        segs.push(cur);
        cur = { raw: '', tokens: [], stdinFile: null, stdoutFile: null, append: false, background: false };
        continue;
      }
      // unknown op -> ignore or include as token
      cur.tokens.push(String(op));
      continue;
    }

    // word
    const rawTok = normalizeWordTok(tok);
    // If this token corresponds to a command-substitution placeholder, expose
    // a special marker token object so the executor can resolve it.
    if (typeof rawTok === 'string' && rawTok.startsWith('__CMD_SUB_') && extracted.map[rawTok]) {
      // keep as JSON-ish marker in the token array (executor should detect)
      const info = extracted.map[rawTok];
      cur.tokens.push(JSON.stringify({ cmdSub: info.cmd, quote: info.quote }));
      continue;
    }

    cur.tokens.push(rawTok);
  }

  // push last
  if (cur.tokens.length > 0 || cur.stdinFile || cur.stdoutFile) {
    cur.raw = cur.tokens.join(' ');
    segs.push(cur);
  }
  return segs;
}

export default parseCommandLine;
