import { resolvePath } from '@/engine/core/pathUtils';
import type { ShellRunResult } from './executor';
import type { Process } from './process';

export interface ScriptShell {
  run(
    line: string,
    callbacks?: { stdout?: (data: string) => void; stderr?: (data: string) => void }
  ): Promise<ShellRunResult>;
  getEnvironment(): Readonly<Record<string, string>>;
  expandWords(
    source: string,
    callbacks?: { stdout?: (data: string) => void; stderr?: (data: string) => void }
  ): Promise<string[]>;
  setEnv(key: string, value: string): void;
  unsetEnv(key: string): void;
  setPipefail(enabled: boolean): void;
  setNounset(enabled: boolean): void;
}

/**
 * ScriptRunner - Executes shell scripts with control flow support
 * Handles if/elif/else/fi, for loops, while loops, break/continue
 */

const MAX_LOOP = 10000;

interface ScriptOptions {
  errexit: boolean;
  nounset: boolean;
}

function updateOptions(command: string, options: ScriptOptions, shell: ScriptShell): void {
  const words = command.split(/\s+/).slice(1);
  let enabled = true;
  for (let index = 0; index < words.length; index++) {
    const word = words[index];
    if (word === undefined || word.length < 2) continue;
    const prefix = word[0];
    if (prefix !== '-' && prefix !== '+') continue;
    enabled = prefix === '-';
    if (word === '-o' || word === '+o') {
      const option = words[index + 1];
      if (option === 'pipefail') shell.setPipefail(enabled);
      index += 1;
      continue;
    }
    for (const flag of word.slice(1)) {
      if (flag === 'e') options.errexit = enabled;
      if (flag === 'u') {
        options.nounset = enabled;
        shell.setNounset(enabled);
      }
      if (flag === 'o') {
        const option = words[index + 1];
        if (option === 'pipefail') shell.setPipefail(enabled);
        index += 1;
      }
    }
  }
}

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
 * Evaluate a condition used in if/elif/while
 */
async function runCondition(
  condExpr: string,
  shell: ScriptShell
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
  const res = await shell.run(s);
  const codeNum = typeof res.code === 'number' ? res.code : 0;
  const finalCode = neg % 2 === 1 ? (codeNum === 0 ? 1 : 0) : codeNum;
  return { stdout: res.stdout, stderr: res.stderr, code: finalCode };
}

export type RunRangeResult = number | 'break' | 'continue' | { exit: number };

/**
 * Run a range [start, end) of lines; supports break/continue signaling
 */
async function runRange(
  lines: string[],
  start: number,
  end: number,
  proc: Process,
  shell: ScriptShell,
  options: ScriptOptions
): Promise<RunRangeResult> {
  let rangeEnd = end;
  let lastStatus = 0;
  for (let i = start; i < rangeEnd; i++) {
    shell.setEnv('?', String(lastStatus));
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
          rangeEnd += 1;
        }
        thenIdx = i;
      } else {
        // search for a 'then' statement in subsequent statements
        for (let j = i + 1; j < lines.length; j++) {
          const t = (lines[j] || '').trim();
          if (/^then\b/.test(t)) {
            thenIdx = j;
            const trailing = t.replace(/^then\b/, '').trim();
            if (trailing) {
              lines.splice(j + 1, 0, trailing);
              rangeEnd += 1;
            }
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
      const condEval = await runCondition(condLine, shell);

      // forward any output from condition evaluation to the script process
      if (condEval.stdout) proc.writeStdout(condEval.stdout);
      if (condEval.stderr) proc.writeStderr(condEval.stderr);
      if (condEval.code === 0) {
        const thenStart = thenIdx === -1 ? i + 1 : thenIdx + 1;
        const thenEnd = elifs.length > 0 ? elifs[0] : elseIdx !== -1 ? elseIdx : fiIdx;
        const r = await runRange(lines, thenStart, thenEnd, proc, shell, options);
        if (typeof r !== 'number') return r;
        lastStatus = r;
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
            if (trailing) {
              // insert the trailing inline statements right after this elif
              lines.splice(eIdx + 1, 0, trailing);
              rangeEnd += 1;
              // Adjust stored indices because we've mutated `lines`.
              // Subsequent `elifs` indices (those after the current one) must be incremented.
              for (let t = k + 1; t < elifs.length; t++) {
                elifs[t] = elifs[t] + 1;
              }
              // If else/fi were recorded and come after this insert point, shift them too.
              if (elseIdx !== -1 && elseIdx > eIdx) elseIdx += 1;
              if (fiIdx !== -1 && fiIdx > eIdx) fiIdx += 1;
            }
          }
          const eRes = await runCondition(eCond, shell);

          if (eRes.stdout) proc.writeStdout(eRes.stdout);
          if (eRes.stderr) proc.writeStderr(eRes.stderr);
          if (eRes.code === 0) {
            const eThenStart = eIdx + 1;
            const eThenEnd = k + 1 < elifs.length ? elifs[k + 1] : elseIdx !== -1 ? elseIdx : fiIdx;
            const r = await runRange(lines, eThenStart, eThenEnd, proc, shell, options);
            if (typeof r !== 'number') return r;
            lastStatus = r;
            matched = true;
            break;
          }
        }
        if (!matched && elseIdx !== -1) {
          const r = await runRange(lines, elseIdx + 1, fiIdx, proc, shell, options);
          if (typeof r !== 'number') return r;
          lastStatus = r;
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
        if (trailing) {
          lines.splice(i + 1, 0, trailing);
          rangeEnd += 1;
        }
      }
      // find 'do' for this for-header first
      let doIdx = -1;
      let doneIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const t = (lines[j] || '').trim();
        if (/^do\b/.test(t)) {
          const trailing = t.replace(/^do\b/, '').trim();
          if (trailing) {
            lines.splice(j + 1, 0, trailing);
            rangeEnd += 1;
          }
          doIdx = j;
          break;
        }
      }

      if (doIdx === -1) {
        // no 'do' found: skip to end or next 'done'
        for (let j = i + 1; j < lines.length; j++) {
          if (/^done\b/.test((lines[j] || '').trim())) {
            doneIdx = j;
            break;
          }
        }
      } else {
        // find matching 'done' from doIdx+1, tracking nested loop/while/until/select depth
        let depth = 1;
        for (let j = doIdx + 1; j < lines.length; j++) {
          const t = (lines[j] || '').trim();
          if (/^(for|while|until|select)\b/.test(t)) {
            depth++;
            continue;
          }
          if (/^done\b/.test(t)) {
            depth--;
            if (depth === 0) {
              doneIdx = j;
              break;
            }
          }
        }
      }
      if (doIdx === -1 || doneIdx === -1) {
        i = doneIdx === -1 ? lines.length - 1 : doneIdx;
        continue;
      }
      const bodyStart = doIdx + 1;
      const bodyEnd = doneIdx;
      const items = await shell.expandWords(itemsStr, {
        stderr: data => proc.writeStderr(data),
      });
      let iter = 0;
      for (const it of items) {
        if (++iter > MAX_LOOP) break;
        shell.setEnv(varName, it);
        const r = await runRange(lines, bodyStart, bodyEnd, proc, shell, options);
        if (r === 'break') break;
        if (r === 'continue') continue;
        if (typeof r !== 'number') return r;
        lastStatus = r;
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
        if (trailing) {
          lines.splice(i + 1, 0, trailing);
          rangeEnd += 1;
        }
      }
      let doIdx = -1;
      let doneIdx = -1;
      for (let j = i + 1; j < lines.length; j++) {
        const t = (lines[j] || '').trim();
        if (/^do\b/.test(t) && doIdx === -1) {
          const trailing = t.replace(/^do\b/, '').trim();
          if (trailing) {
            lines.splice(j + 1, 0, trailing);
            rangeEnd += 1;
          }
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
        const cres = await runCondition(condLine, shell);
        if (cres.stdout) proc.writeStdout(cres.stdout);
        if (cres.stderr) proc.writeStderr(cres.stderr);
        if (cres.code !== 0) break;
        const r = await runRange(lines, bodyStart, bodyEnd, proc, shell, options);
        if (r === 'break') break;
        if (r === 'continue') continue;
        if (typeof r !== 'number') return r;
        lastStatus = r;
      }
      i = doneIdx;
      continue;
    }

    // break / continue
    if (trimmed === 'break') return 'break';
    if (trimmed === 'continue') return 'continue';

    // exit builtin (POSIX): exit [n]
    if (/^exit\b/.test(trimmed)) {
      const parts = trimmed.split(/\s+/).slice(1);
      // Too many args -> error, do not exit script (behave like interactive shells)
      if (parts.length > 1) {
        proc.writeStderr('exit: too many arguments\n');
        continue;
      }
      let code = 0;
      if (parts.length === 1) {
        const a = parts[0];
        if (!/^-?\d+$/.test(a)) {
          proc.writeStderr('exit: numeric argument required\n');
          return { exit: 2 };
        }
        code = Number(a) & 0xff;
      }
      return { exit: code };
    }

    if (trimmed === 'set' || trimmed.startsWith('set ')) {
      updateOptions(trimmed, options, shell);
      lastStatus = 0;
      continue;
    }

    if (trimmed === 'unset' || trimmed.startsWith('unset ')) {
      const names = trimmed.split(/\s+/).slice(1);
      if (names.length === 0) {
        proc.writeStderr('unset: missing variable name\n');
        lastStatus = 1;
      } else {
        for (const name of names) shell.unsetEnv(name);
        lastStatus = 0;
      }
      continue;
    }

    // Pass real-time output callbacks to enable streaming output
    const res = await shell.run(trimmed, {
      stdout: (data: string) => {
        proc.writeStdout(data);
      },
      stderr: (data: string) => {
        proc.writeStderr(data);
      },
    });
    lastStatus = res.code ?? 0;
    if (options.nounset && res.fatalError) return { exit: lastStatus };
    if (options.errexit && lastStatus !== 0 && res.errexitEligible !== false) {
      return { exit: lastStatus };
    }
  }
  return lastStatus;
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
  shell: ScriptShell
): Promise<number> {
  const rawLines = splitPhysicalLines(text);
  // Build statement list by splitting each physical line at top-level semicolons
  const lines: string[] = [];
  for (const rl of rawLines) {
    const parts = splitTopLevelSemicolons(rl);
    for (const p of parts) {
      lines.push(p);
    }
  }

  const options: ScriptOptions = { errexit: false, nounset: false };
  const environment = shell.getEnvironment();
  const currentDirectory = environment.PWD;
  if (!currentDirectory) throw new Error('PWD is required to run a shell script');
  shell.setEnv('?', '0');
  if (args[0]) {
    const scriptPath = resolvePath(currentDirectory, args[0]);
    shell.setEnv('0', scriptPath);
    shell.setEnv('BASH_SOURCE', scriptPath);
    shell.setEnv('BASH_SOURCE[0]', scriptPath);
  }
  for (let index = 1; index < args.length; index++) {
    const value = args[index];
    if (value !== undefined) shell.setEnv(String(index), value);
  }
  shell.setEnv('@', args.slice(1).join(' '));
  const result = await runRange(lines, 0, lines.length, proc, shell, options);

  // Return the script status to the shell executor.
  if (typeof result === 'object' && result && 'exit' in result) {
    return result.exit;
  }
  if (typeof result === 'number') return result;
  return 0;
}
