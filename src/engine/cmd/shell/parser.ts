// Parser wrapper using shell-quote
// Produces Segment[] compatible with StreamShell's Segment type

import shellQuote from 'shell-quote';

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

export function parseCommandLine(line: string): Segment[] {
  const toks = shellQuote.parse(line);
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
    const w = normalizeWordTok(tok);
    cur.tokens.push(w);
  }

  // push last
  if (cur.tokens.length > 0 || cur.stdinFile || cur.stdoutFile) {
    cur.raw = cur.tokens.join(' ');
    segs.push(cur);
  }
  return segs;
}

export default parseCommandLine;
