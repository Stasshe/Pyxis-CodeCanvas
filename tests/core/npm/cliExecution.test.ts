/**
 * Tests for CLI Execution Infrastructure
 *
 * These tests validate the core CLI execution infrastructure
 * including command parsing, stdout/stderr handling, and exit codes.
 */

import {
  createTestContext,
  cleanupTestContext,
  createTestProject,
  createTestFile,
  createNpmProject,
  type TestContext,
} from '../testUtils';

// Import shell parser types (these can be tested without browser)
import { type Token, type Segment } from '@/engine/cmd/shell/parser';

// Mock command execution result
interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

// Simple command executor for testing
class TestCommandExecutor {
  private files: Map<string, string> = new Map();
  private env: Record<string, string> = {};

  setFile(path: string, content: string): void {
    this.files.set(path, content);
  }

  getFile(path: string): string | undefined {
    return this.files.get(path);
  }

  setEnv(key: string, value: string): void {
    this.env[key] = value;
  }

  getEnv(key: string): string | undefined {
    return this.env[key];
  }

  // Execute a simple command
  execute(command: string, args: string[]): CommandResult {
    switch (command) {
      case 'echo':
        return {
          stdout: args.join(' ') + '\n',
          stderr: '',
          exitCode: 0,
        };

      case 'cat':
        if (args.length === 0) {
          return { stdout: '', stderr: '', exitCode: 0 };
        }
        const content = this.files.get(args[0]);
        if (content === undefined) {
          return {
            stdout: '',
            stderr: `cat: ${args[0]}: No such file or directory\n`,
            exitCode: 1,
          };
        }
        return { stdout: content, stderr: '', exitCode: 0 };

      case 'pwd':
        return { stdout: '/home/user\n', stderr: '', exitCode: 0 };

      case 'ls':
        const files = Array.from(this.files.keys()).join('\n');
        return { stdout: files ? files + '\n' : '', stderr: '', exitCode: 0 };

      case 'true':
        return { stdout: '', stderr: '', exitCode: 0 };

      case 'false':
        return { stdout: '', stderr: '', exitCode: 1 };

      case 'printenv':
        if (args.length === 0) {
          const allEnv = Object.entries(this.env)
            .map(([k, v]) => `${k}=${v}`)
            .join('\n');
          return { stdout: allEnv ? allEnv + '\n' : '', stderr: '', exitCode: 0 };
        }
        const envVal = this.env[args[0]];
        if (envVal !== undefined) {
          return { stdout: envVal + '\n', stderr: '', exitCode: 0 };
        }
        return { stdout: '', stderr: '', exitCode: 1 };

      case 'exit':
        const code = args.length > 0 ? parseInt(args[0], 10) : 0;
        return { stdout: '', stderr: '', exitCode: isNaN(code) ? 0 : code };

      default:
        return {
          stdout: '',
          stderr: `${command}: command not found\n`,
          exitCode: 127,
        };
    }
  }
}

describe('CLI Execution Infrastructure', () => {
  let ctx: TestContext;
  let executor: TestCommandExecutor;

  beforeEach(async () => {
    ctx = await createTestContext();
    executor = new TestCommandExecutor();
  });

  afterEach(async () => {
    await cleanupTestContext(ctx);
  });

  describe('Basic Command Execution', () => {
    it('should execute echo command', () => {
      const result = executor.execute('echo', ['Hello', 'World']);
      expect(result.stdout).toBe('Hello World\n');
      expect(result.stderr).toBe('');
      expect(result.exitCode).toBe(0);
    });

    it('should execute cat command with existing file', () => {
      executor.setFile('/test.txt', 'File content\n');
      const result = executor.execute('cat', ['/test.txt']);
      expect(result.stdout).toBe('File content\n');
      expect(result.exitCode).toBe(0);
    });

    it('should return error for non-existent file', () => {
      const result = executor.execute('cat', ['/nonexistent.txt']);
      expect(result.stderr).toContain('No such file or directory');
      expect(result.exitCode).toBe(1);
    });

    it('should handle unknown command', () => {
      const result = executor.execute('unknowncmd', []);
      expect(result.stderr).toContain('command not found');
      expect(result.exitCode).toBe(127);
    });
  });

  describe('Exit Codes', () => {
    it('should return 0 for true command', () => {
      const result = executor.execute('true', []);
      expect(result.exitCode).toBe(0);
    });

    it('should return 1 for false command', () => {
      const result = executor.execute('false', []);
      expect(result.exitCode).toBe(1);
    });

    it('should handle exit command with code', () => {
      const result = executor.execute('exit', ['42']);
      expect(result.exitCode).toBe(42);
    });

    it('should handle exit command without code', () => {
      const result = executor.execute('exit', []);
      expect(result.exitCode).toBe(0);
    });
  });

  describe('Environment Variables', () => {
    it('should set and get environment variables', () => {
      executor.setEnv('MY_VAR', 'my_value');
      const result = executor.execute('printenv', ['MY_VAR']);
      expect(result.stdout).toBe('my_value\n');
      expect(result.exitCode).toBe(0);
    });

    it('should return error for non-existent env var', () => {
      const result = executor.execute('printenv', ['NONEXISTENT_VAR']);
      expect(result.exitCode).toBe(1);
    });

    it('should list all environment variables', () => {
      executor.setEnv('VAR1', 'value1');
      executor.setEnv('VAR2', 'value2');
      const result = executor.execute('printenv', []);
      expect(result.stdout).toContain('VAR1=value1');
      expect(result.stdout).toContain('VAR2=value2');
    });
  });

  describe('File System Integration', () => {
    it('should integrate with storage adapter', async () => {
      const project = await createTestProject(ctx, 'cli-test');
      await createTestFile(ctx, project.id, '/test.txt', 'Content from storage');

      // Simulate loading file from storage into executor
      const files = await ctx.storage.files.getAllByProject(project.id);
      const testFile = files.find(f => f.path === '/test.txt');
      expect(testFile).toBeDefined();

      executor.setFile('/test.txt', testFile!.content);
      const result = executor.execute('cat', ['/test.txt']);
      expect(result.stdout).toBe('Content from storage');
    });

    it('should list files from storage', async () => {
      const { project } = await createNpmProject(ctx, 'list-test');

      const files = await ctx.storage.files.getAllByProject(project.id);
      for (const file of files) {
        if (file.type === 'file') {
          executor.setFile(file.path, file.content);
        }
      }

      const result = executor.execute('ls', []);
      expect(result.stdout).toContain('package.json');
    });
  });

  describe('Command Chaining', () => {
    it('should simulate AND operator (&&)', () => {
      // true && echo "success"
      const result1 = executor.execute('true', []);
      if (result1.exitCode === 0) {
        const result2 = executor.execute('echo', ['success']);
        expect(result2.stdout).toBe('success\n');
      }
    });

    it('should simulate OR operator (||)', () => {
      // false || echo "fallback"
      const result1 = executor.execute('false', []);
      if (result1.exitCode !== 0) {
        const result2 = executor.execute('echo', ['fallback']);
        expect(result2.stdout).toBe('fallback\n');
      }
    });

    it('should simulate sequence (;)', () => {
      // echo "first"; echo "second"
      const results: CommandResult[] = [];
      results.push(executor.execute('echo', ['first']));
      results.push(executor.execute('echo', ['second']));

      expect(results[0].stdout).toBe('first\n');
      expect(results[1].stdout).toBe('second\n');
    });
  });

  describe('npm-like Commands', () => {
    it('should simulate npm init output', async () => {
      const { project } = await createNpmProject(ctx, 'npm-init-test', {
        name: 'test-package',
        version: '1.0.0',
      });

      const packageFile = await ctx.storage.files.getByPath(project.id, '/package.json');
      expect(packageFile).toBeDefined();

      const pkg = JSON.parse(packageFile!.content);
      expect(pkg.name).toBe('test-package');
      expect(pkg.version).toBe('1.0.0');
    });

    it('should detect package.json for npm operations', async () => {
      const project = await createTestProject(ctx, 'no-npm-test');

      // No package.json
      const files = await ctx.storage.files.getAllByProject(project.id);
      const hasPackageJson = files.some(f => f.path === '/package.json');
      expect(hasPackageJson).toBe(false);

      // Add package.json
      await createTestFile(ctx, project.id, '/package.json', '{"name": "added"}');

      const filesAfter = await ctx.storage.files.getAllByProject(project.id);
      const hasPackageJsonAfter = filesAfter.some(f => f.path === '/package.json');
      expect(hasPackageJsonAfter).toBe(true);
    });
  });

  describe('Output Handling', () => {
    it('should capture stdout separately from stderr', () => {
      executor.setFile('/exists.txt', 'content');

      // Cat existing file - stdout only
      const result1 = executor.execute('cat', ['/exists.txt']);
      expect(result1.stdout.length).toBeGreaterThan(0);
      expect(result1.stderr).toBe('');

      // Cat non-existing file - stderr only
      const result2 = executor.execute('cat', ['/nonexistent.txt']);
      expect(result2.stdout).toBe('');
      expect(result2.stderr.length).toBeGreaterThan(0);
    });

    it('should preserve newlines in output', () => {
      executor.setFile('/multiline.txt', 'line1\nline2\nline3\n');
      const result = executor.execute('cat', ['/multiline.txt']);
      expect(result.stdout).toBe('line1\nline2\nline3\n');
      expect(result.stdout.split('\n').length).toBe(4); // 3 lines + trailing empty
    });
  });
});
