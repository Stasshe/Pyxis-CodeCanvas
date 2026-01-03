/**
 * Builtin Command Provider
 * Provides shell builtin commands following POSIX conventions.
 */

import type {
  CommandProvider,
  CompletionResult,
  ExecutionResult,
  IExecutionContext,
  IStreamManager,
} from './types';
import {
  isShellBuiltin,
  isSpecialBuiltin,
  ProviderType,
  SHELL_BUILTINS,
  SPECIAL_BUILTINS,
} from './types';

/**
 * Builtin handler function signature
 */
type BuiltinHandler = (
  args: string[],
  context: IExecutionContext,
  streams: IStreamManager
) => Promise<ExecutionResult>;

/**
 * Builtin Command Provider Implementation
 */
export class BuiltinCommandProvider implements CommandProvider {
  readonly id = 'pyxis.provider.builtin';
  readonly type = ProviderType.BUILTIN;
  readonly priority = 100;
  readonly cacheTTL = -1; // Infinite cache - builtins are static

  private builtins: Map<string, BuiltinHandler> = new Map();
  private projectId: string = '';
  private projectName: string = '';

  constructor() {
    this.registerAllBuiltins();
  }

  private registerAllBuiltins(): void {
    // Register all builtin commands
    this.registerBuiltin('cd', this.cdCommand.bind(this));
    this.registerBuiltin('pwd', this.pwdCommand.bind(this));
    this.registerBuiltin('echo', this.echoCommand.bind(this));
    this.registerBuiltin('export', this.exportCommand.bind(this));
    this.registerBuiltin('unset', this.unsetCommand.bind(this));
    this.registerBuiltin('set', this.setCommand.bind(this));
    this.registerBuiltin('alias', this.aliasCommand.bind(this));
    this.registerBuiltin('unalias', this.unaliasCommand.bind(this));
    this.registerBuiltin('type', this.typeCommand.bind(this));
    this.registerBuiltin('test', this.testCommand.bind(this));
    this.registerBuiltin('[', this.testCommand.bind(this));
    this.registerBuiltin('true', this.trueCommand.bind(this));
    this.registerBuiltin('false', this.falseCommand.bind(this));
    this.registerBuiltin('exit', this.exitCommand.bind(this));
    this.registerBuiltin('return', this.returnCommand.bind(this));
    this.registerBuiltin('break', this.breakCommand.bind(this));
    this.registerBuiltin('continue', this.continueCommand.bind(this));
    this.registerBuiltin(':', this.colonCommand.bind(this));
    this.registerBuiltin('source', this.sourceCommand.bind(this));
    this.registerBuiltin('.', this.sourceCommand.bind(this));
    this.registerBuiltin('shift', this.shiftCommand.bind(this));
    this.registerBuiltin('read', this.readCommand.bind(this));
    this.registerBuiltin('printf', this.printfCommand.bind(this));
    this.registerBuiltin('command', this.commandCommand.bind(this));
    this.registerBuiltin('builtin', this.builtinCommand.bind(this));
    this.registerBuiltin('node', this.nodeCommand.bind(this));
  }

  private registerBuiltin(name: string, handler: BuiltinHandler): void {
    this.builtins.set(name, handler);
  }

  async canHandle(command: string, _context: IExecutionContext): Promise<boolean> {
    return this.builtins.has(command) || isShellBuiltin(command) || isSpecialBuiltin(command);
  }

  async execute(
    command: string,
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const handler = this.builtins.get(command);
    if (!handler) {
      await streams.writeStderr(`${command}: builtin command not implemented\n`);
      return { exitCode: 1 };
    }

    try {
      return await handler(args, context, streams);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`${command}: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  async complete(partial: string, _context: IExecutionContext): Promise<CompletionResult[]> {
    const results: CompletionResult[] = [];
    const allBuiltins = [...SHELL_BUILTINS, ...SPECIAL_BUILTINS];

    for (const cmd of allBuiltins) {
      if (cmd.startsWith(partial)) {
        results.push({
          text: cmd,
          type: 'command',
          description: 'shell builtin',
        });
      }
    }

    return results;
  }

  async getHelp(command: string): Promise<string> {
    const helpTexts: Record<string, string> = {
      cd: 'cd [dir] - Change the current directory',
      pwd: 'pwd - Print the current working directory',
      echo: 'echo [args...] - Display a line of text',
      export: 'export [name[=value]...] - Set export attribute for variables',
      unset: 'unset [name...] - Unset values and attributes of variables',
      set: 'set [options] - Set or unset shell options',
      alias: 'alias [name[=value]...] - Define or display aliases',
      unalias: 'unalias [name...] - Remove alias definitions',
      type: 'type [name...] - Describe a command',
      test: 'test [expr] - Evaluate conditional expression',
      '[': '[ expr ] - Evaluate conditional expression',
      true: 'true - Return successful result',
      false: 'false - Return unsuccessful result',
      exit: 'exit [n] - Exit the shell with status n',
      return: 'return [n] - Return from a function with status n',
      break: 'break [n] - Exit from a loop',
      continue: 'continue [n] - Resume next iteration of a loop',
      ':': ': - Null command (no-op)',
      source: 'source file - Execute commands from file in current shell',
      '.': '. file - Execute commands from file in current shell',
      shift: 'shift [n] - Shift positional parameters',
      read: 'read [name...] - Read a line and split into variables',
      printf: 'printf format [args...] - Format and print data',
      command: 'command [-v] cmd - Execute cmd bypassing functions',
      builtin: 'builtin cmd - Execute cmd as a shell builtin',
    };

    return helpTexts[command] || `${command}: no help available`;
  }

  async initialize(projectId: string, context: IExecutionContext): Promise<void> {
    this.projectId = projectId;
    this.projectName = context.projectName;
  }

  // Builtin implementations

  private async cdCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const targetDir = args[0] || context.getEnv('HOME') || '/';

    try {
      // Get unix commands to validate directory
      const unix = await context.getSystemModule('unixCommands');

      // Resolve path relative to current directory
      let resolvedPath: string;
      if (targetDir === '-') {
        // cd - : go to previous directory
        resolvedPath = context.getEnv('OLDPWD') || context.cwd;
        await streams.writeStdout(resolvedPath + '\n');
      } else if (targetDir.startsWith('/')) {
        resolvedPath = targetDir;
      } else {
        // Resolve relative path
        resolvedPath = context.cwd === '/'
          ? `/${targetDir}`
          : `${context.cwd}/${targetDir}`;
      }

      // Normalize path (handle .. and .)
      resolvedPath = this.normalizePath(resolvedPath);

      // Check if directory exists using the unix commands
      if (unix && typeof (unix as any).cd === 'function') {
        await (unix as any).cd(resolvedPath);
      }

      // Update context
      context.setCwd(resolvedPath);

      return { exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await streams.writeStderr(`cd: ${targetDir}: ${message}\n`);
      return { exitCode: 1 };
    }
  }

  private normalizePath(path: string): string {
    const parts = path.split('/').filter(p => p !== '' && p !== '.');
    const stack: string[] = [];

    for (const part of parts) {
      if (part === '..') {
        if (stack.length > 0) {
          stack.pop();
        }
      } else {
        stack.push(part);
      }
    }

    return '/' + stack.join('/');
  }

  private async pwdCommand(
    _args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    await streams.writeStdout(context.cwd + '\n');
    return { exitCode: 0 };
  }

  private async echoCommand(
    args: string[],
    _context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    let noNewline = false;
    let enableEscape = false;
    let startIndex = 0;

    // Process flags
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n') {
        noNewline = true;
        startIndex = i + 1;
      } else if (args[i] === '-e') {
        enableEscape = true;
        startIndex = i + 1;
      } else if (args[i] === '-E') {
        enableEscape = false;
        startIndex = i + 1;
      } else {
        break;
      }
    }

    let output = args.slice(startIndex).join(' ');

    // Process escape sequences if -e is specified
    if (enableEscape) {
      output = output
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\r/g, '\r')
        .replace(/\\\\/g, '\\');
    }

    await streams.writeStdout(output);
    if (!noNewline) {
      await streams.writeStdout('\n');
    }

    return { exitCode: 0 };
  }

  private async exportCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      // Print all exported variables
      for (const [key, value] of Object.entries(context.env)) {
        await streams.writeStdout(`export ${key}="${value}"\n`);
      }
      return { exitCode: 0 };
    }

    // Process each argument
    for (const arg of args) {
      const match = arg.match(/^([A-Za-z_][A-Za-z0-9_]*)(?:=(.*))?$/);
      if (match) {
        const [, name, value] = match;
        if (value !== undefined) {
          context.setEnv(name, value);
        } else {
          // Export existing variable (no-op in our implementation)
          const existing = context.getEnv(name);
          if (existing === undefined) {
            // Variable doesn't exist, set to empty
            context.setEnv(name, '');
          }
        }
      } else {
        await streams.writeStderr(`export: '${arg}': not a valid identifier\n`);
        return { exitCode: 1 };
      }
    }

    return { exitCode: 0 };
  }

  private async unsetCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    let unsetFunctions = false;
    let unsetVariables = true;
    const names: string[] = [];

    for (const arg of args) {
      if (arg === '-f') {
        unsetFunctions = true;
        unsetVariables = false;
      } else if (arg === '-v') {
        unsetVariables = true;
        unsetFunctions = false;
      } else if (!arg.startsWith('-')) {
        names.push(arg);
      }
    }

    for (const name of names) {
      if (unsetVariables) {
        delete context.env[name];
      }
      if (unsetFunctions) {
        context.removeFunction(name);
      }
    }

    return { exitCode: 0 };
  }

  private async setCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      // Print all variables
      for (const [key, value] of Object.entries(context.env)) {
        await streams.writeStdout(`${key}=${value}\n`);
      }
      return { exitCode: 0 };
    }

    // Process options
    for (const arg of args) {
      if (arg.startsWith('-')) {
        for (const char of arg.slice(1)) {
          switch (char) {
            case 'e':
              context.options.errexit = true;
              break;
            case 'u':
              context.options.nounset = true;
              break;
            case 'x':
              context.options.xtrace = true;
              break;
            case 'o':
              // Extended options - handle pipefail
              break;
          }
        }
      } else if (arg.startsWith('+')) {
        for (const char of arg.slice(1)) {
          switch (char) {
            case 'e':
              context.options.errexit = false;
              break;
            case 'u':
              context.options.nounset = false;
              break;
            case 'x':
              context.options.xtrace = false;
              break;
          }
        }
      }
    }

    return { exitCode: 0 };
  }

  private async aliasCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      // Print all aliases
      for (const [name, expansion] of context.aliases) {
        await streams.writeStdout(`alias ${name}='${expansion}'\n`);
      }
      return { exitCode: 0 };
    }

    for (const arg of args) {
      const match = arg.match(/^([^=]+)=(.*)$/);
      if (match) {
        const [, name, value] = match;
        context.setAlias(name, value);
      } else {
        // Print specific alias
        const expansion = context.getAlias(arg);
        if (expansion) {
          await streams.writeStdout(`alias ${arg}='${expansion}'\n`);
        } else {
          await streams.writeStderr(`alias: ${arg}: not found\n`);
          return { exitCode: 1 };
        }
      }
    }

    return { exitCode: 0 };
  }

  private async unaliasCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.includes('-a')) {
      // Remove all aliases
      context.aliases.clear();
      return { exitCode: 0 };
    }

    for (const name of args) {
      if (!context.removeAlias(name)) {
        await streams.writeStderr(`unalias: ${name}: not found\n`);
        return { exitCode: 1 };
      }
    }

    return { exitCode: 0 };
  }

  private async typeCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const opts = { a: false, t: false, p: false };
    const names: string[] = [];

    for (const a of args) {
      if (a.startsWith('-')) {
        for (const ch of a.slice(1)) {
          if (ch === 'a') opts.a = true;
          else if (ch === 't') opts.t = true;
          else if (ch === 'p') opts.p = true;
        }
      } else {
        names.push(a);
      }
    }

    if (names.length === 0) {
      await streams.writeStderr('type: missing operand\n');
      return { exitCode: 1 };
    }

    for (const name of names) {
      const isBuiltin = this.builtins.has(name) || isShellBuiltin(name);
      const alias = context.getAlias(name);
      const func = context.getFunction(name);

      if (opts.t) {
        if (alias) {
          await streams.writeStdout('alias\n');
        } else if (func) {
          await streams.writeStdout('function\n');
        } else if (isBuiltin) {
          await streams.writeStdout('builtin\n');
        } else {
          await streams.writeStderr(`type: ${name}: not found\n`);
          return { exitCode: 1 };
        }
      } else {
        let found = false;

        if (alias) {
          await streams.writeStdout(`${name} is aliased to '${alias}'\n`);
          found = true;
          if (!opts.a) continue;
        }

        if (func) {
          await streams.writeStdout(`${name} is a function\n`);
          found = true;
          if (!opts.a) continue;
        }

        if (isBuiltin) {
          await streams.writeStdout(`${name} is a shell builtin\n`);
          found = true;
        }

        if (!found) {
          await streams.writeStderr(`type: ${name}: not found\n`);
          return { exitCode: 1 };
        }
      }
    }

    return { exitCode: 0 };
  }

  private async testCommand(
    args: string[],
    _context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // Remove trailing ] if present (for [ ... ] syntax)
    const testArgs = args[args.length - 1] === ']' ? args.slice(0, -1) : args;

    if (testArgs.length === 0) {
      return { exitCode: 1 };
    }

    // Single argument: true if non-empty string
    if (testArgs.length === 1) {
      return { exitCode: testArgs[0].length > 0 ? 0 : 1 };
    }

    // Two arguments: unary operators
    if (testArgs.length === 2) {
      const op = testArgs[0];
      const val = testArgs[1];

      switch (op) {
        case '-n':
          return { exitCode: val.length > 0 ? 0 : 1 };
        case '-z':
          return { exitCode: val.length === 0 ? 0 : 1 };
        case '-f':
        case '-d':
        case '-e':
          // File tests - would need fs access
          return { exitCode: 1 };
        case '!':
          return { exitCode: val.length === 0 ? 0 : 1 };
      }
    }

    // Three arguments: binary operators
    if (testArgs.length >= 3) {
      const a = testArgs[0];
      const op = testArgs[1];
      const b = testArgs[2];

      switch (op) {
        case '=':
        case '==':
          return { exitCode: a === b ? 0 : 1 };
        case '!=':
          return { exitCode: a !== b ? 0 : 1 };
        case '-eq':
          return { exitCode: Number(a) === Number(b) ? 0 : 1 };
        case '-ne':
          return { exitCode: Number(a) !== Number(b) ? 0 : 1 };
        case '-gt':
          return { exitCode: Number(a) > Number(b) ? 0 : 1 };
        case '-lt':
          return { exitCode: Number(a) < Number(b) ? 0 : 1 };
        case '-ge':
          return { exitCode: Number(a) >= Number(b) ? 0 : 1 };
        case '-le':
          return { exitCode: Number(a) <= Number(b) ? 0 : 1 };
      }
    }

    return { exitCode: 1 };
  }

  private async trueCommand(
    _args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    return { exitCode: 0 };
  }

  private async falseCommand(
    _args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    return { exitCode: 1 };
  }

  private async exitCommand(
    args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    const exitCode = args[0] ? Number.parseInt(args[0], 10) : 0;
    return {
      exitCode: Number.isNaN(exitCode) ? 2 : exitCode,
      metadata: { shouldExit: true },
    };
  }

  private async returnCommand(
    args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    const exitCode = args[0] ? Number.parseInt(args[0], 10) : 0;
    return {
      exitCode: Number.isNaN(exitCode) ? 2 : exitCode,
      metadata: { isReturn: true },
    };
  }

  private async breakCommand(
    args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    const n = args[0] ? Number.parseInt(args[0], 10) : 1;
    return {
      exitCode: 0,
      metadata: { isBreak: true, breakLevel: n },
    };
  }

  private async continueCommand(
    args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    const n = args[0] ? Number.parseInt(args[0], 10) : 1;
    return {
      exitCode: 0,
      metadata: { isContinue: true, continueLevel: n },
    };
  }

  private async colonCommand(
    _args: string[],
    _context: IExecutionContext,
    _streams: IStreamManager
  ): Promise<ExecutionResult> {
    // No-op command
    return { exitCode: 0 };
  }

  private async sourceCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      await streams.writeStderr('source: filename argument required\n');
      return { exitCode: 2 };
    }

    // Source command execution is handled by the shell executor
    // This returns metadata to indicate source should be executed in current context
    return {
      exitCode: 0,
      metadata: {
        isSource: true,
        filename: args[0],
        sourceArgs: args.slice(1),
      },
    };
  }

  private async shiftCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    const n = args[0] ? Number.parseInt(args[0], 10) : 1;

    if (Number.isNaN(n) || n < 0) {
      await streams.writeStderr(`shift: ${args[0]}: numeric argument required\n`);
      return { exitCode: 1 };
    }

    if (n > context.positionalParams.length) {
      await streams.writeStderr('shift: shift count out of range\n');
      return { exitCode: 1 };
    }

    context.positionalParams = context.positionalParams.slice(n);
    return { exitCode: 0 };
  }

  private async readCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // Basic read implementation - would need stdin access
    // For now, just set empty values
    for (const name of args.filter(a => !a.startsWith('-'))) {
      context.setEnv(name, '');
    }
    return { exitCode: 0 };
  }

  private async printfCommand(
    args: string[],
    _context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      await streams.writeStderr('printf: usage: printf format [arguments]\n');
      return { exitCode: 2 };
    }

    const format = args[0];
    const values = args.slice(1);

    // Simple printf implementation
    let output = format;
    let valueIndex = 0;

    output = output.replace(/%([sdiofx%])/g, (match, specifier) => {
      if (specifier === '%') return '%';
      const value = values[valueIndex++] || '';
      switch (specifier) {
        case 's':
          return String(value);
        case 'd':
        case 'i':
          return String(Number.parseInt(value, 10) || 0);
        case 'f':
          return String(Number.parseFloat(value) || 0);
        case 'o':
          return (Number.parseInt(value, 10) || 0).toString(8);
        case 'x':
          return (Number.parseInt(value, 10) || 0).toString(16);
        default:
          return match;
      }
    });

    // Process escape sequences
    output = output
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\\');

    await streams.writeStdout(output);
    return { exitCode: 0 };
  }

  private async commandCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // command -v: describe command
    if (args[0] === '-v') {
      const cmd = args[1];
      if (!cmd) {
        await streams.writeStderr('command: -v: option requires an argument\n');
        return { exitCode: 2 };
      }

      if (this.builtins.has(cmd) || isShellBuiltin(cmd)) {
        await streams.writeStdout(`${cmd}\n`);
        return { exitCode: 0 };
      }

      await streams.writeStderr(`command: ${cmd}: not found\n`);
      return { exitCode: 1 };
    }

    // command cmd: execute cmd bypassing functions
    // This returns metadata to indicate execution should skip functions
    return {
      exitCode: 0,
      metadata: {
        isCommand: true,
        skipFunctions: true,
        commandArgs: args,
      },
    };
  }

  private async builtinCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    if (args.length === 0) {
      await streams.writeStderr('builtin: usage: builtin shell-builtin [args]\n');
      return { exitCode: 2 };
    }

    const cmd = args[0];
    if (!this.builtins.has(cmd) && !isShellBuiltin(cmd)) {
      await streams.writeStderr(`builtin: ${cmd}: not a shell builtin\n`);
      return { exitCode: 1 };
    }

    // Execute the builtin directly
    return this.execute(cmd, args.slice(1), context, streams);
  }

  /**
   * Node command - Execute JavaScript files using NodeRuntime
   */
  private async nodeCommand(
    args: string[],
    context: IExecutionContext,
    streams: IStreamManager
  ): Promise<ExecutionResult> {
    // Support version flags
    if (args.length >= 1 && (args[0] === '-v' || args[0] === '--version')) {
      await streams.writeStdout('v18.0.0 (custom build)\n');
      return { exitCode: 0 };
    }

    if (args.length === 0) {
      await streams.writeStderr('Usage: node <file.js>\n');
      return { exitCode: 2 };
    }

    try {
      // Dynamic import NodeRuntime
      const { NodeRuntime } = await import('../../../runtime/nodeRuntime');

      // Create debug console that writes to streams
      const debugConsole = {
        log: (...logArgs: unknown[]) => {
          const output = logArgs
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ') + '\n';
          streams.writeStdout(output);
        },
        error: (...logArgs: unknown[]) => {
          const output = logArgs
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');
          streams.writeStderr(`\x1b[31m${output}\x1b[0m\n`);
        },
        warn: (...logArgs: unknown[]) => {
          const output = logArgs
            .map(arg => (typeof arg === 'object' ? JSON.stringify(arg, null, 2) : String(arg)))
            .join(' ');
          streams.writeStdout(`\x1b[33m${output}\x1b[0m\n`);
        },
        clear: () => {},
      };

      // Input handler (not supported in this context)
      const onInput = (_promptText: string, callback: (input: string) => void) => {
        streams.writeStderr('node: interactive input not supported\n');
        callback('');
      };

      // Resolve path
      let entryPath = args[0];
      if (!entryPath.startsWith('/')) {
        entryPath = context.cwd.replace(/\/$/, '') + '/' + entryPath;
      }

      const runtime = new NodeRuntime({
        projectId: context.projectId,
        projectName: context.projectName,
        filePath: entryPath,
        debugConsole,
        onInput,
        terminalColumns: 80,
        terminalRows: 24,
      });

      // Execute
      await runtime.execute(entryPath, args.slice(1));

      // Wait for event loop to complete
      if (typeof runtime.waitForEventLoop === 'function') {
        await runtime.waitForEventLoop();
      }

      return { exitCode: 0 };
    } catch (e: any) {
      const msg = e && e.message ? String(e.message) : String(e);
      await streams.writeStderr(`node: error: ${msg}\n`);
      return { exitCode: 1 };
    }
  }
}

/**
 * Create a new builtin command provider
 */
export function createBuiltinProvider(): BuiltinCommandProvider {
  return new BuiltinCommandProvider();
}
