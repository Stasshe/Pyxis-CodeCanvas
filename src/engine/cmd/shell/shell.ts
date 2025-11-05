import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';

type RunResult = {
  stdout: string;
  stderr: string;
  code: number;
};

type ShellOptions = {
  projectName: string;
  projectId: string;
  // allow injecting a custom unix runner for tests
  unix?: any;
  commandRegistry?: any;
};

/**
 * Minimal POSIX-like shell implemented on top of existing command classes.
 * - Supports pipelines using `|` (passes stdout of left to stdin of right)
 * - Supports basic tokenization with quotes
 * - Provides lightweight `sh`/`bash` file execution by reading file and executing lines
 * - Delegates most functionality to UnixCommands (via terminalCommandRegistry)
 *
 * Note: Terminal.tsx remains responsible for handling `>` / `>>` write-redirection.
 */
export class Shell {
  private projectName: string;
  private projectId: string;
  private unix: any;
  private commandRegistry: any;

  constructor(opts: ShellOptions) {
    this.projectName = opts.projectName;
    this.projectId = opts.projectId;
    this.unix = opts.unix || terminalCommandRegistry.getUnixCommands(opts.projectName, opts.projectId);
    this.commandRegistry = opts.commandRegistry;
  }

  // split by | respecting quotes
  private splitPipes(input: string): string[] {
    const parts: string[] = [];
    let cur = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < input.length; i++) {
      const ch = input[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        cur += ch;
      } else if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        cur += ch;
      } else if (ch === '|' && !inSingle && !inDouble) {
        parts.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    if (cur.trim() !== '') parts.push(cur.trim());
    return parts;
  }

  // tokenize respecting quotes (simple)
  private tokenize(segment: string): string[] {
    const tokens: string[] = [];
    let cur = '';
    let inSingle = false;
    let inDouble = false;
    for (let i = 0; i < segment.length; i++) {
      const ch = segment[i];
      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        continue; // strip quotes
      }
      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        continue; // strip quotes
      }
      if (ch === ' ' && !inSingle && !inDouble) {
        if (cur !== '') {
          tokens.push(cur);
          cur = '';
        }
      } else {
        cur += ch;
      }
    }
    if (cur !== '') tokens.push(cur);
    return tokens;
  }

  // Execute a single segment with optional stdin
  private async execSegment(segment: string, stdin: string): Promise<RunResult> {
    const tokens = this.tokenize(segment);
    if (tokens.length === 0) return { stdout: '', stderr: '', code: 0 };
    const cmd = tokens[0];
    const args = tokens.slice(1);

    try {
      // sh or bash execution from a file: read file and execute lines sequentially
      if (cmd === 'sh' || cmd === 'bash') {
        if (args.length === 0) return { stdout: '', stderr: 'Usage: sh <file>', code: 2 };
        const path = args[0];
        const content = await this.unix.cat(path).catch(() => null);
        if (content === null) return { stdout: '', stderr: `sh: ${path}: No such file`, code: 1 };
        const lines = content
          .split('\n')
          .map((l: string) => l.trim())
          .filter((l: string) => l && !l.startsWith('#'));
        let out = '';
        for (const line of lines) {
          const res = await this.run(line);
          out += res.stdout;
          if (res.stderr) out += res.stderr;
        }
        return { stdout: out, stderr: '', code: 0 };
      }

      // Builtins that can consume stdin
      switch (cmd) {
        case 'echo': {
          const text = args.join(' ');
          const out = await this.unix.echo(text);
          return { stdout: out, stderr: '', code: 0 };
        }
        case 'cat': {
          if (args.length === 0) {
            // cat with no args -> pass through stdin
            return { stdout: stdin || '', stderr: '', code: 0 };
          }
          const out = await this.unix.cat(args[0]);
          return { stdout: out, stderr: '', code: 0 };
        }
        case 'pwd': {
          const out = await this.unix.pwd();
          return { stdout: out, stderr: '', code: 0 };
        }
        case 'ls': {
          const out = await this.unix.ls(args[0]);
          return { stdout: out, stderr: '', code: 0 };
        }
        case 'cd': {
          const arg = args[0] || '/';
          const msg = await this.unix.cd(arg);
          return { stdout: msg, stderr: '', code: 0 };
        }
        case 'head': {
          if (args.length === 0) return { stdout: (stdin || '').split('\n').slice(0, 10).join('\n'), stderr: '', code: 0 };
          const nOpt = args.find(a => a.startsWith('-n'));
          let n = 10;
          let fileArg = args[0];
          if (nOpt) {
            n = parseInt(nOpt.replace('-n', '')) || 10;
            fileArg = args[1] || fileArg;
          }
          const out = await this.unix.head(fileArg, n);
          return { stdout: out, stderr: '', code: 0 };
        }
        case 'tail': {
          if (args.length === 0) return { stdout: (stdin || '').split('\n').slice(-10).join('\n'), stderr: '', code: 0 };
          const nOpt = args.find(a => a.startsWith('-n'));
          let n = 10;
          let fileArg = args[0];
          if (nOpt) {
            n = parseInt(nOpt.replace('-n', '')) || 10;
            fileArg = args[1] || fileArg;
          }
          const out = await this.unix.tail(fileArg, n);
          return { stdout: out, stderr: '', code: 0 };
        }
        case 'grep': {
          // grep PATTERN [FILE...]
          if (args.length === 0) return { stdout: '', stderr: 'grep: missing pattern', code: 2 };
          const pattern = args[0];
          const files = args.slice(1);
          if (files.length === 0) {
            // operate on stdin
            const regex = new RegExp(pattern);
            const lines = (stdin || '').split('\n').filter(l => regex.test(l));
            return { stdout: lines.join('\n'), stderr: '', code: 0 };
          }
          const out = await this.unix.grep(pattern, files);
          return { stdout: out, stderr: '', code: 0 };
        }
        default: {
          // Try extension command registry if available
          if (this.commandRegistry && this.commandRegistry.hasCommand && this.commandRegistry.hasCommand(cmd)) {
            try {
              const cwd = await this.unix.pwd();
              const res: any = await this.commandRegistry.executeCommand(cmd, args, {
                projectName: this.projectName,
                projectId: this.projectId,
                currentDirectory: cwd,
                stdin,
              });
              return { stdout: String(res || ''), stderr: '', code: 0 };
            } catch (e: any) {
              return { stdout: '', stderr: e.message || String(e), code: 1 };
            }
          }

          // Fall back: try to run as unix command via handler (best-effort)
          try {
            // Some unix handlers expect file args and ignore stdin. For pipeline scenarios we
            // prefer builtins above. Here we call handleUnixCommand via imports to preserve
            // existing behavior for other commands.
            const { handleUnixCommand } = await import('../handlers/unixHandler');
            const res = await handleUnixCommand(cmd, args, this.projectName, this.projectId, async (out: string) => {
              // ignore streaming callback here; we'll use the returned output
            });
            return { stdout: (res && res.output) ? String(res.output).trimEnd() : '', stderr: '', code: res && typeof res.code === 'number' ? res.code : 0 };
          } catch (e: any) {
            return { stdout: '', stderr: `Command not found: ${cmd}`, code: 127 };
          }
        }
      }
    } catch (e: any) {
      return { stdout: '', stderr: e.message || String(e), code: 1 };
    }
  }

  /**
   * Run a full command line which may contain pipelines.
   */
  async run(commandLine: string): Promise<RunResult> {
    const segments = this.splitPipes(commandLine);
    let stdin = '';
    let lastStdout = '';
    let lastStderr = '';
    let lastCode = 0;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const res = await this.execSegment(seg, stdin);
      // next stdin is stdout of this
      stdin = res.stdout || '';
      lastStdout = res.stdout || '';
      if (res.stderr) lastStderr += res.stderr + '\n';
      lastCode = res.code;
      // continue to next
    }

    return { stdout: lastStdout, stderr: lastStderr.trimEnd(), code: lastCode };
  }
}

export default Shell;
