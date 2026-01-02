/**
 * Tests for CommandRouter - command categorization and routing
 */

import {
  CommandCategory,
  categorizeCommand,
  getAvailableCommands,
  CommandRouter,
  getCommandRouter,
  resetCommandRouter,
  SHELL_BUILTINS,
  UNIX_COMMANDS,
  TOOL_COMMANDS,
  RUNTIME_COMMANDS,
} from '@/engine/cmd/shell/commandRouter';

describe('CommandRouter - Command Categorization', () => {
  beforeEach(() => {
    resetCommandRouter();
  });

  test('categorizes shell builtins correctly', () => {
    expect(categorizeCommand('test')).toBe(CommandCategory.BUILTIN);
    expect(categorizeCommand('[')).toBe(CommandCategory.BUILTIN);
    expect(categorizeCommand('true')).toBe(CommandCategory.BUILTIN);
    expect(categorizeCommand('echo')).toBe(CommandCategory.BUILTIN);
    expect(categorizeCommand('cd')).toBe(CommandCategory.BUILTIN);
    expect(categorizeCommand('pwd')).toBe(CommandCategory.BUILTIN);
  });

  test('categorizes unix commands correctly', () => {
    expect(categorizeCommand('ls')).toBe(CommandCategory.UNIX);
    expect(categorizeCommand('cat')).toBe(CommandCategory.UNIX);
    expect(categorizeCommand('mkdir')).toBe(CommandCategory.UNIX);
    expect(categorizeCommand('grep')).toBe(CommandCategory.UNIX);
    expect(categorizeCommand('find')).toBe(CommandCategory.UNIX);
  });

  test('categorizes tool commands correctly', () => {
    expect(categorizeCommand('git')).toBe(CommandCategory.TOOL);
    expect(categorizeCommand('npm')).toBe(CommandCategory.TOOL);
    expect(categorizeCommand('npx')).toBe(CommandCategory.TOOL);
    expect(categorizeCommand('pyxis')).toBe(CommandCategory.TOOL);
  });

  test('categorizes runtime commands correctly', () => {
    expect(categorizeCommand('node')).toBe(CommandCategory.RUNTIME);
    expect(categorizeCommand('python')).toBe(CommandCategory.RUNTIME);
    expect(categorizeCommand('python3')).toBe(CommandCategory.RUNTIME);
  });

  test('categorizes unknown commands correctly', () => {
    expect(categorizeCommand('unknowncmd123')).toBe(CommandCategory.UNKNOWN);
    expect(categorizeCommand('notacommand')).toBe(CommandCategory.UNKNOWN);
  });

  test('is case insensitive for categorization', () => {
    expect(categorizeCommand('GIT')).toBe(CommandCategory.TOOL);
    expect(categorizeCommand('Git')).toBe(CommandCategory.TOOL);
    expect(categorizeCommand('LS')).toBe(CommandCategory.UNIX);
    expect(categorizeCommand('NODE')).toBe(CommandCategory.RUNTIME);
  });
});

describe('CommandRouter - Extension Commands', () => {
  beforeEach(() => {
    resetCommandRouter();
  });

  test('extension commands take precedence', () => {
    const mockRegistry = {
      hasCommand: (cmd: string) => cmd === 'myextcmd',
    };

    expect(categorizeCommand('myextcmd', mockRegistry)).toBe(CommandCategory.EXTENSION);
    expect(categorizeCommand('ls', mockRegistry)).toBe(CommandCategory.UNIX);
  });

  test('router with extension registry', () => {
    const router = getCommandRouter();
    const mockRegistry = {
      hasCommand: (cmd: string) => cmd === 'customcmd',
    };
    
    router.setExtensionRegistry(mockRegistry);
    
    expect(router.categorize('customcmd')).toBe(CommandCategory.EXTENSION);
    expect(router.hasCommand('customcmd')).toBe(true);
    expect(router.categorize('ls')).toBe(CommandCategory.UNIX);
  });
});

describe('CommandRouter - Command Sets', () => {
  test('SHELL_BUILTINS contains expected commands', () => {
    expect(SHELL_BUILTINS.has('test')).toBe(true);
    expect(SHELL_BUILTINS.has('[')).toBe(true);
    expect(SHELL_BUILTINS.has('true')).toBe(true);
    expect(SHELL_BUILTINS.has('echo')).toBe(true);
    expect(SHELL_BUILTINS.has('cd')).toBe(true);
  });

  test('UNIX_COMMANDS contains expected commands', () => {
    expect(UNIX_COMMANDS.has('ls')).toBe(true);
    expect(UNIX_COMMANDS.has('cat')).toBe(true);
    expect(UNIX_COMMANDS.has('grep')).toBe(true);
    expect(UNIX_COMMANDS.has('find')).toBe(true);
  });

  test('TOOL_COMMANDS contains expected commands', () => {
    expect(TOOL_COMMANDS.has('git')).toBe(true);
    expect(TOOL_COMMANDS.has('npm')).toBe(true);
    expect(TOOL_COMMANDS.has('pyxis')).toBe(true);
  });

  test('RUNTIME_COMMANDS contains expected commands', () => {
    expect(RUNTIME_COMMANDS.has('node')).toBe(true);
    expect(RUNTIME_COMMANDS.has('python')).toBe(true);
  });
});

describe('CommandRouter - Instance Methods', () => {
  beforeEach(() => {
    resetCommandRouter();
  });

  test('getCommandInfo returns correct info', () => {
    const router = getCommandRouter();
    
    const gitInfo = router.getCommandInfo('git');
    expect(gitInfo.category).toBe(CommandCategory.TOOL);
    expect(gitInfo.description).toBe('external tool');
    
    const lsInfo = router.getCommandInfo('ls');
    expect(lsInfo.category).toBe(CommandCategory.UNIX);
    expect(lsInfo.description).toBe('unix command');
    
    const unknownInfo = router.getCommandInfo('nonexistent');
    expect(unknownInfo.category).toBe(CommandCategory.UNKNOWN);
    expect(unknownInfo.description).toBe('not found');
  });

  test('listCommands returns sorted list', () => {
    const router = getCommandRouter();
    const commands = router.listCommands();
    
    expect(commands).toContain('git');
    expect(commands).toContain('ls');
    expect(commands).toContain('node');
    expect(commands).toContain('test');
    
    // Should be sorted
    const sorted = [...commands].sort();
    expect(commands).toEqual(sorted);
  });

  test('hasCommand returns correct boolean', () => {
    const router = getCommandRouter();
    
    expect(router.hasCommand('git')).toBe(true);
    expect(router.hasCommand('ls')).toBe(true);
    expect(router.hasCommand('node')).toBe(true);
    expect(router.hasCommand('unknowncmd')).toBe(false);
  });
});

describe('getAvailableCommands', () => {
  test('returns commands by category', () => {
    const available = getAvailableCommands();
    
    expect(available[CommandCategory.BUILTIN]).toContain('test');
    expect(available[CommandCategory.UNIX]).toContain('ls');
    expect(available[CommandCategory.TOOL]).toContain('git');
    expect(available[CommandCategory.RUNTIME]).toContain('node');
    expect(available[CommandCategory.UNKNOWN]).toEqual([]);
  });
});
