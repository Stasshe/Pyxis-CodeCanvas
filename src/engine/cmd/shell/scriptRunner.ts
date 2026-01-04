import type { Process } from './process';
import type { StreamShell } from './streamShell';

import expandBraces from './braceExpand';

/**
 * ScriptRunner - Executes shell scripts with control flow support
 * Handles if/elif/else/fi, for loops, while loops, break/continue
 */

const MAX_LOOP = 10000;

/**
 * Split the script into physical lines while respecting quotes, backticks and $(...)
 */
function splitPhysicalLines(src: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inS = false;
  let inD = false;
  let inBT = false;
  let parenDepth = 0; // for $(...)
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '\\') {
      // copy escape and next char if present
      cur += ch;
      if (i + 1 < src.length) cur += src[++i];
      continue;
    }
    if (ch === '`' && !inS && !inD) {
      inBT = !inBT;
      cur += ch;
      continue;
    }
    if (ch === '"' && !inS && !inBT) {
      inD = !inD;
      cur += ch;
      continue;
    }
    if (ch === "'" && !inD && !inBT) {
      inS = !inS;
      cur += ch;
      continue;
    }
    if (!inS && !inD && !inBT) {
      if (ch === '$' && src[i + 1] === '(') {
        parenDepth++;
        cur += ch;
        continue;
      }
      if (ch === '(' && parenDepth > 0) {
        cur += ch;
        continue;
      }
      if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
        cur += ch;
        continue;
      }
      if (ch === '\n' && parenDepth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/**
 * Split a line at top-level semicolons (not inside quotes, backticks, or $(...))
 */
function splitTopLevelSemicolons(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inS = false;
  let inD = false;
  let inBT = false; // backtick
  let parenDepth = 0; // for $( ... )
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    // handle escapes
    if (ch === '\\') {
      cur += ch;
      if (i + 1 < s.length) cur += s[++i];
      continue;
    }
    if (ch === '`' && !inS && !inD) {
      inBT = !inBT;
      cur += ch;
      continue;
    }
    if (ch === "'" && !inD && !inBT) {
      inS = !inS;
      cur += ch;
      continue;
    }
    if (ch === '"' && !inS && !inBT) {
      inD = !inD;
      cur += ch;
      continue;
    }
    if (!inS && !inD && !inBT) {
      if (ch === '$' && s[i + 1] === '(') {
        parenDepth++;
        cur += ch;
        continue;
      }
      if (ch === '(' && parenDepth > 0) {
        cur += ch;
        continue;
      }
      if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
        cur += ch;
        continue;
      }
      if (ch === ';' && parenDepth === 0) {
        out.push(cur);
        cur = '';
        continue;
      }
    }
    cur += ch;
  }
  if (cur !== '') out.push(cur);
  return out;
}

/**
 * Evaluate simple arithmetic $(( ... ))
 */
function evalArithmeticInString(s: string, localVars: Record<string, string>): string {
  return s.replace(/\$\(\((.*?)\)\)/g, (_, expr) => {
    // replace variable names with numeric values from localVars
    const safe = expr.replace(/\b([A-Za-z_][A-Za-z0-9_]*)\b/g, (m: string) => {
      if (/^\d+$/.test(m)) return m;
      const v = localVars[m];
      return String(Number(v || 0));
    });
    // allow only digits, spaces and arithmetic operators
    if (!/^[0-9+\-*/()%\s]+$/.test(safe)) return '0';
    try {
      const val = Function(`return (${safe})`)();
      return String(Number(val));
    } catch (e) {
      return '0';
    }
  });
}

/**
 * Evaluate command-substitutions in a string (supports $(...) and `...`)
 */
async function evalCommandSubstitutions(
  s: string,
  localVars: Record<string, string>,
  shell: StreamShell
): Promise<string> {
  // handle backticks first (non-nested simple support)
  let out = s;
  // backticks: `...` (non nested)
  while (true) {
    const bt = out.indexOf('`');
    if (bt === -1) break;
    let j = bt + 1;
    let buf = '';
    while (j < out.length && out[j] !== '`') {
      buf += out[j++];
    }
    if (j >= out.length) break; // unterminated - leave as-is
    const inner = buf;
    const res = await shell.run(inner);
    const replacement = String(res.stdout || '');
    out = out.slice(0, bt) + replacement + out.slice(j + 1);
  }

  // handle $(...) with nesting
  const findMatching = (str: string, start: number) => {
    let depth = 0;
    for (let k = start; k < str.length; k++) {
      if (str[k] === '(') depth++;
      if (str[k] === ')') {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  };

  while (true) {
    const idx = out.indexOf('$(');
    if (idx === -1) break;
    const openPos = idx + 1; // position of '('
    const end = findMatching(out, openPos);
    if (end === -1) break; // unterminated - stop
    const inner = out.slice(openPos + 1, end);
    // recursively evaluate inner substitutions first
    const innerEval = await evalCommandSubstitutions(inner, localVars, shell);
    const res = await shell.run(innerEval);
    const replacement = String(res.stdout || '');
    out = out.slice(0, idx) + replacement + out.slice(end + 1);
  }

  // After command-substitutions, also perform arithmetic expansion
  try {
    out = evalArithmeticInString(out, localVars);
  } catch (e) {
    // if arithmetic expansion fails, leave the string as-is
  }

  return out;
}

/**
 * Interpolate variables in a line
 */
function interpolate(line: string, localVars: Record<string, string>, args: string[]): string {
  // Supports $0 (script name), $1..$9, $@ (all args), and local vars $VAR or ${VAR}
  let out = line;
  // Replace $@ with context-sensitive expansion
  const replaceAt = (s: string) => {
    let res = '';
    let i = 0;
    while (i < s.length) {
      const idx = s.indexOf('$@', i);
      if (idx === -1) {
        res += s.slice(i);
        break;
      }
      res += s.slice(i, idx);
      // determine quote context at idx
      let inS = false;
      let inD = false;
      for (let j = 0; j < idx; j++) {
        const ch = s[j];
        if (ch === "'" && !inD) inS = !inS;
        if (ch === '"' && !inS) inD = !inD;
      }
      if (inS) {
        // no expansion inside single quotes
        res += '$@';
      } else if (inD) {
        // join args and escape backslashes first, then double quotes
        const joined = (args && args.length > 1 ? args.slice(1) : [])
          .map(a => String(a).replace(/\\/g, '\\\\').replace(/"/g, '\\"'))
          .join(' ');
        res += joined;
      } else {
        // unquoted: expand to individually single-quoted args
        const parts = (args && args.length > 1 ? args.slice(1) : []).map(a => {
          const s = String(a);
          // escape single quotes by closing, inserting \"'\", and reopening
          const esc = s.replace(/'/g, "'\\''");
          return "'" + esc + "'";
        });
        res += parts.join(' ');
      }
      i = idx + 2;
    }
    return res;
  };
  out = replaceAt(out);
  // $0 -> script name (args[0])
  out = out.replace(/\$0\b/g, args[0] || '');
  // positional $1..$9 -> args[1]..args[9]
  for (let i = 1; i <= 9; i++) {
    const val = args[i] || '';
    out = out.replace(new RegExp(`\\$${i}\\b`, 'g'), val);
  }
  // ${VAR} style
  out = out.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name) => {
    if (name in localVars) return localVars[name];
    return '';
  });
  // $VAR style (word boundary)
  for (const k of Object.keys(localVars)) {
    out = out.replace(new RegExp('\\$' + k + '\\b', 'g'), localVars[k]);
  }
  return out;
}

/**
 * Unified evaluation pipeline for a script fragment
 */
async function evaluateLine(
  lineStr: string,
  localVars: Record<string, string>,
  args: string[],
  shell: StreamShell
): Promise<string> {
  // first do variable/positional interpolation
  const afterInterp = interpolate(lineStr, localVars, args);
  // then expand command substitutions and nested arithmetic
  const afterCmdSub = await evalCommandSubstitutions(afterInterp, localVars, shell);
  // finally arithmetic expansion
  try {
    return evalArithmeticInString(afterCmdSub, localVars);
  } catch (e) {
    return afterCmdSub;
  }
}

/**
 * Evaluate a condition used in if/elif/while
 */
async function runCondition(
  condExpr: string,
  localVars: Record<string, string>,
  args: string[],
  shell: StreamShell
): Promise<{ stdout: string; stderr: string; code: number }> {
  if (!condExpr) return { stdout: '', stderr: '', code: 1 };
  // count leading ! operators
  let s = condExpr.trimStart();
  let neg = 0;
  while (s.startsWith('!')) {
    neg++;
    s = s.slice(1).trimStart();
  }
  if (!s) return { stdout: '', stderr: '', code: neg % 2 === 1 ? 0 : 1 };
  // evaluate expansions then run
  const evaled = await evaluateLine(s, localVars, args, shell);
  const res = await shell.run(evaled);
  const codeNum = typeof res.code === 'number' ? res.code : 0;
  const finalCode = neg % 2 === 1 ? (codeNum === 0 ? 1 : 0) : codeNum;
  return { stdout: res.stdout, stderr: res.stderr, code: finalCode };
}

export type RunRangeResult = 'ok' | 'break' | 'continue' | { exit: number };

/**
 * Run a range [start, end) of lines; supports break/continue signaling
 */
async function runRange(
  lines: string[],
  start: number,
  end: number,
  localVars: Record<string, string>,
  args: string[],
  proc: Process,
  shell: StreamShell
): Promise<RunRangeResult> {
  for (let i = start; i < end; i++) {
    const raw = lines[i] ?? '';
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    // Skip structural tokens that may appear as separate statements after splitting
    if (
      trimmed === 'then' ||
      trimmed === 'fi' ||
      trimmed === 'do' ||
      trimmed === 'done' ||
      trimmed === 'else' ||
      trimmed.startsWith('elif ')
    ) {
      continue;
    }

    // IF block
    if (/^if\b/.test(trimmed)) {
      // extract conditional expression between 'if' and 'then' (may be on same statement)
      let condLine = trimmed.replace(/^if\s+/, '').trim();
      let thenIdx = -1;
      // if this statement contains 'then'
      const thenMatch = condLine.match(/\bthen\b(.*)$/);
      if (thenMatch) {
        condLine = condLine.slice(0, thenMatch.index).trim();
        const trailing = thenMatch[1] ? thenMatch[1].trim() : '';
        if (trailing) {
          lines.splice(i + 1, 0, trailing);
        }
        thenIdx = i;
      } else {
        // search for a 'then' statement in subsequent statements
        for (let j = i + 1; j < lines.length; j++) {
          const t = (lines[j] || '').trim();
          if (/^then\b/.test(t)) {
            thenIdx = j;
            const trailing = t.replace(/^then\b/, '').trim();
            if (trailing) lines.splice(j + 1, 0, trailing);
            break;
          }
        }
      }

      // find matching fi, and collect top-level elif/else positions
      let depth = 1;
      let fiIdx = -1;
      const elifs: number[] = [];
      let elseIdx = -1;
      for (let j = thenIdx === -1 ? i + 1 : thenIdx + 1; j < lines.length; j++) {
        const t = (lines[j] || '').trim();
        if (/^if\b/.test(t)) {
          depth++;
        }
        if (/^fi\b/.test(t)) {
          depth--;
          if (depth === 0) {
            fiIdx = j;
            break;
          }
        }
        if (depth === 1) {
          if (/^elif\b/.test(t)) elifs.push(j);
          if (/^else\b/.test(t) && elseIdx === -1) elseIdx = j;
        }
      }
      if (fiIdx === -1) {
        fiIdx = lines.length - 1;
      }

      // evaluate condition
      const condEval = await runCondition(condLine, localVars, args, shell);

      // forward any output from condition evaluation to the script process
      if (condEval.stdout) proc.writeStdout(condEval.stdout);
      if (condEval.stderr) proc.writeStderr(condEval.stderr);
      if (condEval.code === 0) {
        const thenStart = thenIdx === -1 ? i + 1 : thenIdx + 1;
        const thenEnd = elifs.length > 0 ? elifs[0] : elseIdx !== -1 ? elseIdx : fiIdx;
        const r = await runRange(lines, thenStart, thenEnd, localVars, args, proc, shell);
        if (r !== 'ok') return r;
      } else {
        // check elifs in order
        let matched = false;
        for (let k = 0; k < elifs.length; k++) {
          const eIdx = elifs[k];
          const eLine = (lines[eIdx] || '').trim();
          let eCond = eLine.replace(/^elif\s+/, '').trim();
          const m = eCond.match(/\bthen\b(.*)$/);
          if (m) {
            eCond = eCond.slice(0, m.index).trim();
            const trailing = m[1] ? m[1].trim() : '';
            if (trailing) lines.splice(eIdx + 1, 0, trailing);
          }
          const eRes = await runCondition(eCond, localVars, args, shell);

          if (eRes.stdout) proc.writeStdout(eRes.stdout);
          if (eRes.stderr) proc.writeStderr(eRes.stderr);
          if (eRes.code === 0) {
            const eThenStart = eIdx + 1;
            const eThenEnd = k + 1 < elifs.length ? elifs[k + 1] : elseIdx !== -1 ? elseIdx : fiIdx;
            const r = await runRange(lines, eThenStart, eThenEnd, localVars, args, proc, shell);
            if (r !== 'ok') return r;
            matched = true;
            break;
          }
        }
        if (!matched && elseIdx !== -1) {
          const r = await runRange(lines, elseIdx + 1, fiIdx, { ...localVars }, args, proc, shell);
          if (r !== 'ok') return r;
        }
      }
      // advance i to fiIdx
      i = fiIdx;
      continue;
    }

    // FOR block
    if (/^for\b/.test(trimmed)) {
      const m = trimmed.match(/^for\s+(\w+)\s+in\s*(.*)$/);
      if (!m) {
        continue;
      }
      const varName = m[1];
      let itemsStr = m[2] ? m[2].trim() : '';
      // if itemsStr contains 'do' (inline), split
      if (/\bdo\b/.test(itemsStr)) {
        const parts = itemsStr.split(/\bdo\b/);
        itemsStr = parts[0].trim();
        const trailing = parts.slice(1).join('do').trim();
        if (trailing) lines.splice(i + 1, 0, trailing);
      }
      // find do and matching done
      let doIdx = -1;
      let doneIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const t = (lines[j] || '').trim();
        if (/^do\b/.test(t) && doIdx === -1) {
          const trailing = t.replace(/^do\b/, '').trim();
          if (trailing) lines.splice(j + 1, 0, trailing);
          doIdx = j;
        }
        if (/^done\b/.test(t)) {
          doneIdx = j;
          break;
        }
      }
      if (doIdx === -1 || doneIdx === -1) {
        i = doneIdx === -1 ? lines.length - 1 : doneIdx;
        continue;
      }
      const bodyStart = doIdx + 1;
      const bodyEnd = doneIdx;
      const interpItems = await evaluateLine(itemsStr, localVars, args, shell);
      // split items and support simple brace expansion
      const rawItems = interpItems.split(/\s+/).filter(Boolean);
      const items: string[] = [];
      for (const it of rawItems) {
        const expanded = expandBraces(it);
        if (expanded.length > 1 || expanded[0] !== it) items.push(...expanded);
        else items.push(it);
      }
      let iter = 0;
      for (const it of items) {
        if (++iter > MAX_LOOP) break;
        // set loop variable in localVars
        localVars[varName] = it;
        const r = await runRange(lines, bodyStart, bodyEnd, localVars, args, proc, shell);
        if (r === 'break') break;
        if (r === 'continue') continue;
        if (typeof r === 'object' && r && 'exit' in r) return r;
      }
      i = doneIdx;
      continue;
    }

    // WHILE block
    if (/^while\b/.test(trimmed)) {
      let condLine = trimmed.replace(/^while\s+/, '').trim();
      // handle inline do
      if (/\bdo\b/.test(condLine)) {
        const parts = condLine.split(/\bdo\b/);
        condLine = parts[0].trim();
        const trailing = parts.slice(1).join('do').trim();
        if (trailing) lines.splice(i + 1, 0, trailing);
      }
      let doIdx = -1;
      let doneIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const t = (lines[j] || '').trim();
        if (/^do\b/.test(t) && doIdx === -1) {
          const trailing = t.replace(/^do\b/, '').trim();
          if (trailing) lines.splice(j + 1, 0, trailing);
          doIdx = j;
        }
        if (/^done\b/.test(t)) {
          doneIdx = j;
          break;
        }
      }
      if (doIdx === -1 || doneIdx === -1) {
        i = doneIdx === -1 ? lines.length - 1 : doneIdx;
        continue;
      }
      const bodyStart = doIdx + 1;
      const bodyEnd = doneIdx;
      let count = 0;
      while (true) {
        if (++count > MAX_LOOP) break;
        const cres = await runCondition(condLine, localVars, args, shell);
        if (cres.stdout) proc.writeStdout(cres.stdout);
        if (cres.stderr) proc.writeStderr(cres.stderr);
        if (cres.code !== 0) break;
        const r = await runRange(lines, bodyStart, bodyEnd, localVars, args, proc, shell);
        if (r === 'break') break;
        if (r === 'continue') continue;
        if (typeof r === 'object' && r && 'exit' in r) return r;
      }
      i = doneIdx;
      continue;
    }

    // break / continue
    if (trimmed === 'break') return 'break';
    if (trimmed === 'continue') return 'continue';

    // regular command or assignment: interpolate and execute
    let execLine = interpolate(trimmed, localVars, args);

    // handle `set ...` as a noop for now
    if (execLine.startsWith('set ')) {
      continue;
    }

    // assignment-only: VAR=VALUE (no command)
    const assignMatch = execLine.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/s);
    if (assignMatch) {
      const name = assignMatch[1];
      let rhs = assignMatch[2] ?? '';
      rhs = rhs.trim();
      if (
        (rhs.startsWith("'") && rhs.endsWith("'")) ||
        (rhs.startsWith('"') && rhs.endsWith('"'))
      ) {
        rhs = rhs.slice(1, -1);
      }
      rhs = evalArithmeticInString(rhs, localVars);
      try {
        const evaluated = await evalCommandSubstitutions(rhs, localVars, shell);
        localVars[name] = evaluated;
      } catch (e) {
        localVars[name] = rhs;
      }
      continue;
    }
    // For non-assignment commands, perform full evaluation pipeline
    try {
      execLine = await evaluateLine(execLine, localVars, args, shell);
    } catch (e) {
      // ignore evaluation errors and use original execLine
    }
    // Pass real-time output callbacks to enable streaming output
    const res = await shell.run(execLine, {
      stdout: (data: string) => {
        proc.writeStdout(data);
      },
      stderr: (data: string) => {
        proc.writeStderr(data);
      },
    });
    // Note: output is already written via callbacks, no need to write again
    // continue even on non-zero exit
  }
  return 'ok';
}

/**
 * Execute a script text with control flow support
 * @param text - Script text
 * @param args - Positional args passed to the script (argv[0..])
 * @param proc - Process to write output to
 * @param shell - StreamShell instance for running commands
 */
export async function runScript(
  text: string,
  args: string[],
  proc: Process,
  shell: StreamShell
): Promise<void> {
  const rawLines = splitPhysicalLines(text);
  // Build statement list by splitting each physical line at top-level semicolons
  const lines: string[] = [];
  for (const rl of rawLines) {
    const parts = splitTopLevelSemicolons(rl);
    for (const p of parts) {
      lines.push(p);
    }
  }

  const result = await runRange(lines, 0, lines.length, {}, args, proc, shell);

  // If an exit object was returned, terminate the script process
  if (typeof result === 'object' && result && 'exit' in result) {
    try {
      proc.exit(result.exit);
    } catch (e) {}
    return;
  }
}
