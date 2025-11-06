// AST-based tokenizer and parser for simple shell command lines
// Produces Segment[] compatible with StreamShell's Segment type

export class ParseError extends Error {
  public pos: number | null;
  constructor(message: string, pos: number | null = null) {
    super(message);
    this.name = 'ParseError';
    this.pos = pos;
  }
}

export type Token = { text: string; quote: 'single' | 'double' | null; cmdSub?: string };

export type Segment = {
  raw: string;
  tokens: Token[];
  stdinFile?: string | null;
  stdoutFile?: string | null;
  stderrFile?: string | null;
  stderrToStdout?: boolean;
  stdoutToStderr?: boolean;
  append?: boolean;
  background?: boolean;
};

// Extract command-substitution segments and replace them with placeholders so
// our tokenizer can safely treat them as words. Supports backticks and $(...).
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
    // allow backticks except inside single quotes; backticks may appear inside double quotes
    if (ch === '`' && !inSingle) {
      let j = i + 1;
      let buf = '';
      while (j < line.length && line[j] !== '`') {
        buf += line[j++];
      }
        if (j >= line.length || line[j] !== '`') throw new ParseError('Unterminated backtick command substitution', i);
        const key = `__CMD_SUB_${id++}__`;
        // If we're inside double quotes, record that so the executor can avoid field-splitting
        map[key] = { cmd: buf, quote: inDouble ? 'double' : null };
      out += key;
      i = j + 1;
      continue;
    }
    if (ch === '$' && line[i + 1] === '(' && !inSingle) {
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
      if (depth > 0) throw new ParseError('Unterminated $(...) command substitution', i);
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

// Variable expansion similar to previous implementation (respect single quotes)
function expandVariables(input: string, env: Record<string, string>): string {
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
      if (input[i + 1] === '{') {
        let j = i + 2;
        let name = '';
        while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) name += input[j++];
        if (input[j] === '}') j++;
        out += env[name] ?? '';
        i = j;
        continue;
      }
      let j = i + 1;
      let name = '';
      while (j < input.length && /[A-Za-z0-9_]/.test(input[j])) name += input[j++];
      if (name.length > 0) {
        out += env[name] ?? '';
        i = j;
        continue;
      }
      out += '$';
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

// Simple tokenizer that returns an array of tokens where operators are objects {op: '|'|'>'|...}
function tokenizeLine(line: string): Array<string | { op: string }> {
  const tokens: Array<string | { op: string }> = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    // handle escapes
    if (ch === '\\') {
      if (i + 1 < line.length) {
        cur += line[i + 1];
        i += 2;
        continue;
      }
      cur += ch;
      i++;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      cur += ch;
      i++;
      continue;
    }
    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      cur += ch;
      i++;
      continue;
    }
    if (!inSingle && !inDouble) {
      // check multi-char operators first
      if (ch === '>' && line[i + 1] === '>') {
        if (cur !== '') { tokens.push(cur); cur = ''; }
        tokens.push({ op: '>>' });
        i += 2;
        continue;
      }
      if (ch === '|' || ch === '<' || ch === '>' || ch === '&' || ch === ';') {
        if (cur !== '') { tokens.push(cur); cur = ''; }
        tokens.push({ op: ch });
        i++;
        continue;
      }
      if (/\t|\s/.test(ch)) {
        if (cur !== '') { tokens.push(cur); cur = ''; }
        i++;
        continue;
      }
    }
    cur += ch;
    i++;
  }
  if (cur !== '') tokens.push(cur);
  return tokens;
}

export function parseCommandLine(line: string, env: Record<string, string> = process.env as any): Segment[] {
  const extracted = extractCommandSubstitutions(line);
  const expanded = expandVariables(extracted.line, env);
  const toks = tokenizeLine(expanded);

  const segs: Segment[] = [];
  let cur: Segment = { raw: '', tokens: [], stdinFile: null, stdoutFile: null, append: false, background: false };

  const pushCur = () => {
    if (cur.tokens.length > 0 || cur.stdinFile || cur.stdoutFile) {
      cur.raw = cur.tokens.map(t => t.text).join(' ');
      segs.push(cur);
    }
    cur = { raw: '', tokens: [], stdinFile: null, stdoutFile: null, append: false, background: false };
  };

  const makeTokenFromRaw = (raw: any): Token => {
    const s = String(raw);
    let quote: 'single' | 'double' | null = null;
    let text = s;
    if (text.length >= 2) {
      const f = text[0];
      const l = text[text.length - 1];
      if ((f === '"' && l === '"') || (f === "'" && l === "'")) {
        quote = f === "'" ? 'single' : 'double';
        text = text.slice(1, -1);
      }
    }
    return { text, quote };
  };

  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (typeof tok === 'object' && 'op' in tok) {
      const op = tok.op;
      if (op === '|') {
        pushCur();
        continue;
      }
      if (op === '>' || op === '>>') {
        // check if previous token in cur is a numeric fd (e.g. '2>file' or '2> file')
        let fd: number | null = null;
        if (cur.tokens.length > 0) {
          const last = cur.tokens[cur.tokens.length - 1];
          if (last && typeof last.text === 'string' && last.quote === null && /^\d+$/.test(last.text)) {
            fd = Number(last.text);
            cur.tokens.pop();
          }
        }

        // next token may be '&' indicating fd duplication (e.g. '2>&1')
        let next = toks[++i];
        if (typeof next === 'object' && next.op === '&') {
          // consume following token as the target fd
          const target = toks[++i];
          const tkn2 = makeTokenFromRaw(target);
          const targetFd = tkn2.text;
          if (fd === 2 && targetFd === '1') {
            cur.stderrToStdout = true;
          } else if (fd === 1 && targetFd === '2') {
            // 1>&2 -> route stdout to stderr
            cur.stdoutToStderr = true;
          }
          cur.append = op === '>>';
          continue;
        }

        const tkn = makeTokenFromRaw(next);
        if (fd === 2) {
          cur.stderrFile = tkn.text;
        } else {
          cur.stdoutFile = tkn.text;
          cur.append = op === '>>';
        }
        continue;
      }
      if (op === '<') {
        const next = toks[++i];
        const tkn = makeTokenFromRaw(next);
        cur.stdinFile = tkn.text;
        continue;
      }
      if (op === '&') {
        // Support &> redirection (both stdout and stderr to file), e.g. '&> file' or '&>> file'
        const lookahead = toks[i + 1];
        if (typeof lookahead === 'object' && (lookahead.op === '>' || lookahead.op === '>>')) {
          // consume '>' or '>>'
          const outOp = toks[++i] as any;
          const next = toks[++i];
          const tkn = makeTokenFromRaw(next);
          cur.stdoutFile = tkn.text;
          cur.stderrFile = tkn.text;
          cur.append = outOp.op === '>>';
          continue;
        }
        // otherwise '&' as background operator
        cur.background = true;
        continue;
      }
      if (op === ';') {
        pushCur();
        continue;
      }
      // unknown op -> treat as token
      cur.tokens.push({ text: op, quote: null });
      continue;
    }

    // word token
    const rawTok = String(tok);
    const tkn = makeTokenFromRaw(rawTok);

    // If this token is exactly a command-substitution placeholder, attach cmdSub
    if (tkn.text.startsWith('__CMD_SUB_') && extracted.map[tkn.text]) {
      const info = extracted.map[tkn.text];
      cur.tokens.push({ text: tkn.text, quote: info.quote ?? tkn.quote, cmdSub: info.cmd });
      continue;
    }

    cur.tokens.push({ text: tkn.text, quote: tkn.quote, cmdSub: undefined });
  }

  pushCur();
  return segs;
}

export default parseCommandLine;
