import StreamShell from '@/engine/cmd/shell/streamShell';
import { fileRepository } from '@/engine/core/fileRepository';
import { resetGlobalRegistry } from '@/engine/cmd/shell/providers';

describe('Shell Script Integration Tests', () => {
  let projectId: string;
  let projectName: string;
  let mockUnix: any;
  let mockFileRepo: any;

  beforeEach(async () => {
    // Reset the global provider registry before each test
    await resetGlobalRegistry();
    
    projectId = `test-project-${Date.now()}`;
    projectName = 'test-project';

    // ファイルシステムのモック（メモリ内で動作）
    const memoryFiles = new Map<string, { path: string; content: string; type: string }>();

    mockFileRepo = {
      getProjectFiles: jest.fn(async (pid: string) => {
        return Array.from(memoryFiles.values()).filter(f => f.path.startsWith('/'));
      }),
      getFileByPath: jest.fn(async (pid: string, path: string) => {
        return memoryFiles.get(path) || null;
      }),
      createFile: jest.fn(async (pid: string, path: string, content: string, type: string) => {
        memoryFiles.set(path, { path, content, type });
        return { id: `file-${Date.now()}`, path, content, type };
      }),
      saveFile: jest.fn(async (file: any) => {
        memoryFiles.set(file.path, file);
        return file;
      }),
    };

    // 基本的なUnixコマンドのモック（実際に動作するように）
    let currentDir = '/';
    mockUnix = {
      pwd: jest.fn(async () => currentDir),
      cd: jest.fn(async (path: string) => {
        if (!path || path === '/') {
          currentDir = '/';
          return '';
        }
        // 簡易的なパス解決
        if (path.startsWith('/')) {
          currentDir = path;
        } else if (path === '..') {
          const parts = currentDir.split('/').filter(Boolean);
          parts.pop();
          currentDir = '/' + parts.join('/');
        } else {
          currentDir = currentDir === '/' ? `/${path}` : `${currentDir}/${path}`;
        }
        return '';
      }),
      ls: jest.fn(async (path?: string) => {
        const files = Array.from(memoryFiles.values());
        const targetPath = path || currentDir;
        const filtered = files
          .filter(f => {
            const dir = f.path.substring(0, f.path.lastIndexOf('/')) || '/';
            return dir === targetPath;
          })
          .map(f => f.path.split('/').pop())
          .join('\n');
        return filtered || '';
      }),
      cat: jest.fn(async (path: string) => {
        // パスを正規化
        const normalized = path.startsWith('/') ? path : `${currentDir}/${path}`;
        const file = memoryFiles.get(normalized);
        if (!file) throw new Error(`cat: ${path}: No such file or directory`);
        return file.content;
      }),
      echo: jest.fn(async (text: string) => text + '\n'),
      mkdir: jest.fn(async (path: string, recursive: boolean) => {
        return `mkdir: created directory '${path}'`;
      }),
      touch: jest.fn(async (path: string) => {
        const normalized = path.startsWith('/') ? path : `${currentDir}/${path}`;
        if (!memoryFiles.has(normalized)) {
          memoryFiles.set(normalized, { path: normalized, content: '', type: 'file' });
        }
        return '';
      }),
      rm: jest.fn(async (path: string, recursive: boolean) => {
        const normalized = path.startsWith('/') ? path : `${currentDir}/${path}`;
        memoryFiles.delete(normalized);
        return '';
      }),
      grep: jest.fn(async (pattern: string, files: string[], options?: string[], stdin?: string | null) => {
        const regex = new RegExp(pattern);
        const results: string[] = [];
        
        // Handle stdin if provided
        if (stdin !== null && stdin !== undefined) {
          const lines = stdin.split('\n');
          lines.forEach(line => {
            if (regex.test(line)) results.push(line);
          });
        }
        
        // Handle files
        for (const file of files) {
          const normalized = file.startsWith('/') ? file : `${currentDir}/${file}`;
          const f = memoryFiles.get(normalized);
          if (f) {
            const lines = f.content.split('\n');
            lines.forEach(line => {
              if (regex.test(line)) results.push(line);
            });
          }
        }
        return results.join('\n');
      }),
      head: jest.fn(async (pathOrContent: string, n: number, _options?: string[], stdin?: string | null) => {
        // Handle stdin if provided
        if (stdin !== null && stdin !== undefined) {
          return stdin.split('\n').slice(0, n).join('\n');
        }
        // Handle file
        const path = pathOrContent;
        const normalized = path.startsWith('/') ? path : `${currentDir}/${path}`;
        const file = memoryFiles.get(normalized);
        if (!file) throw new Error(`head: ${path}: No such file or directory`);
        return file.content.split('\n').slice(0, n).join('\n');
      }),
      tail: jest.fn(async (pathOrContent: string, n: number, _options?: string[], stdin?: string | null) => {
        // Handle stdin if provided
        if (stdin !== null && stdin !== undefined) {
          const lines = stdin.split('\n').filter(l => l.length > 0);
          return lines.slice(-n).join('\n');
        }
        // Handle file
        const path = pathOrContent;
        const normalized = path.startsWith('/') ? path : `${currentDir}/${path}`;
        const file = memoryFiles.get(normalized);
        if (!file) throw new Error(`tail: ${path}: No such file or directory`);
        return file.content.split('\n').slice(-n).join('\n');
      }),
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Shell Script Execution', () => {
    test('simple echo script', async () => {
      const script = `#!/bin/sh
echo "Hello World"
echo "Second line"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('Hello World');
      expect(result.stdout).toContain('Second line');
      expect(result.code).toBe(0);
    });

    test('script with comments and blank lines', async () => {
      const script = `#!/bin/sh
# This is a comment
echo "Line 1"

# Another comment
echo "Line 2"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('Line 1');
      expect(result.stdout).toContain('Line 2');
      expect(result.code).toBe(0);
    });
  });

  describe('Control Flow - If/Else', () => {
    test('if-then-fi with true condition', async () => {
      const script = `#!/bin/sh
if echo "test"; then
  echo "condition passed"
fi
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('test');
      expect(result.stdout).toContain('condition passed');
      expect(result.code).toBe(0);
    });

    test('if-then-else-fi with false condition', async () => {
      const script = `#!/bin/sh
#falseコマンドは存在しないため、エラーとなり条件が偽になる
if false 2>/dev/null; then
  echo "should not print"
else
  echo "else branch executed"
fi
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).not.toContain('should not print');
      expect(result.stdout).toContain('else branch executed');
      expect(result.code).toBe(0);
    });

    test('if-elif-else complex condition', async () => {
      const script = `#!/bin/sh
VAR="two"
if echo "$VAR" | grep "one" >/dev/null; then
  echo "matched one"
elif echo "$VAR" | grep "two" >/dev/null; then
  echo "matched two"
else
  echo "no match"
fi
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('matched two');
      expect(result.stdout).not.toContain('matched one');
      expect(result.stdout).not.toContain('no match');
      expect(result.code).toBe(0);
    });
  });

  describe('Control Flow - Loops', () => {
    test('for loop iteration', async () => {
      const script = `#!/bin/sh
for i in apple banana cherry
do
  echo "fruit: $i"
done
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('fruit: apple');
      expect(result.stdout).toContain('fruit: banana');
      expect(result.stdout).toContain('fruit: cherry');
      expect(result.code).toBe(0);
    });

    test('while loop with counter', async () => {
      const script = `#!/bin/sh
COUNT=1
while echo "$COUNT" | grep -E "^[1-3]$" >/dev/null
do
  echo "iteration $COUNT"
  COUNT=$((COUNT + 1))
done
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('iteration 1');
      expect(result.stdout).toContain('iteration 2');
      expect(result.stdout).toContain('iteration 3');
      expect(result.stdout).not.toContain('iteration 4');
      expect(result.code).toBe(0);
    });

    test('for loop with break', async () => {
      const script = `#!/bin/sh
for num in 1 2 3 4 5
do
  echo "number: $num"
  if echo "$num" | grep "3" >/dev/null; then
    break
  fi
done
echo "after loop"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('number: 1');
      expect(result.stdout).toContain('number: 2');
      expect(result.stdout).toContain('number: 3');
      expect(result.stdout).not.toContain('number: 4');
      expect(result.stdout).toContain('after loop');
      expect(result.code).toBe(0);
    });

    test('for loop with continue', async () => {
      const script = `#!/bin/sh
for val in a b c d
do
  if echo "$val" | grep "b" >/dev/null; then
    continue
  fi
  echo "value: $val"
done
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('value: a');
      expect(result.stdout).not.toContain('value: b');
      expect(result.stdout).toContain('value: c');
      expect(result.stdout).toContain('value: d');
      expect(result.code).toBe(0);
    });
  });

  describe('Variable Assignment and Interpolation', () => {
    test('simple variable assignment', async () => {
      const script = `#!/bin/sh
NAME="World"
echo "Hello $NAME"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('Hello World');
      expect(result.code).toBe(0);
    });

    test('variable with command substitution', async () => {
      const script = `#!/bin/sh
OUTPUT=$(echo "substituted")
echo "Result: $OUTPUT"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('Result: substituted');
      expect(result.code).toBe(0);
    });

    test('positional parameters $0 $1 $2', async () => {
      const script = `#!/bin/sh
echo "Script: $0"
echo "Arg1: $1"
echo "Arg2: $2"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh first second');

      expect(result.stdout).toContain('Script: /test.sh');
      expect(result.stdout).toContain('Arg1: first');
      expect(result.stdout).toContain('Arg2: second');
      expect(result.code).toBe(0);
    });

    test('$@ expansion (all arguments)', async () => {
      const script = `#!/bin/sh
echo "All args: $@"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh alpha beta gamma');

      expect(result.stdout).toContain('All args: alpha beta gamma');
      expect(result.code).toBe(0);
    });
  });

  describe('Command Substitution', () => {
    test('backtick command substitution', async () => {
      const script = `#!/bin/sh
RESULT=\`echo "backtick test"\`
echo "Output: $RESULT"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('Output: backtick test');
      expect(result.code).toBe(0);
    });

    test('nested command substitution', async () => {
      const script = `#!/bin/sh
INNER=$(echo "nested")
OUTER=$(echo "outer $INNER")
echo "$OUTER"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('outer nested');
      expect(result.code).toBe(0);
    });
  });

  describe('File Operations Integration', () => {
    test('create, write, and read file', async () => {
      const script = `#!/bin/sh
echo "first line" > /output.txt
echo "second line" >> /output.txt
cat /output.txt
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('first line');
      expect(result.stdout).toContain('second line');
      expect(result.code).toBe(0);

      // ファイルが実際に作成されたか確認
      const files = await mockFileRepo.getProjectFiles(projectId);
      const outputFile = files.find((f: any) => f.path === '/output.txt');
      expect(outputFile).toBeDefined();
      expect(outputFile.content).toContain('first line');
      expect(outputFile.content).toContain('second line');
    });

    test('grep in script', async () => {
      await mockFileRepo.createFile(
        projectId,
        '/data.txt',
        'apple\nbanana\ncherry\napricot\n',
        'file'
      );

      const script = `#!/bin/sh
grep "^a" /data.txt
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('apple');
      expect(result.stdout).toContain('apricot');
      expect(result.stdout).not.toContain('banana');
      expect(result.stdout).not.toContain('cherry');
      expect(result.code).toBe(0);
    });
  });

  describe('Pipeline in Scripts', () => {
    test('pipeline within script', async () => {
      const script = `#!/bin/sh
echo "line1
line2
line3" | grep "line2"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('line2');
      expect(result.stdout).not.toContain('line1');
      expect(result.stdout).not.toContain('line3');
      expect(result.code).toBe(0);
    });

    test('multiple pipes in script', async () => {
      await mockFileRepo.createFile(
        projectId,
        '/numbers.txt',
        '1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n',
        'file'
      );

      const script = `#!/bin/sh
cat /numbers.txt | head -n 5 | tail -n 2
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('4');
      expect(result.stdout).toContain('5');
      expect(result.stdout).not.toContain('1');
      expect(result.stdout).not.toContain('6');
      expect(result.code).toBe(0);
    });
  });

  describe('Error Handling', () => {
    test('non-existent command should fail', async () => {
      const script = `#!/bin/sh
nonexistent_command
echo "after error"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      // エラーメッセージがstderrに出力される (case-insensitive check)
      expect(result.stderr.toLowerCase()).toContain('command not found');
      // スクリプトは継続実行される（set -e が無い場合）
      expect(result.stdout).toContain('after error');
    });

    test('reading non-existent file should show error', async () => {
      const script = `#!/bin/sh
cat /nonexistent.txt
echo "continued"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stderr).toContain('No such file');
      expect(result.stdout).toContain('continued');
    });
  });

  describe('Complex Real-World Script', () => {
    test('build and test workflow simulation', async () => {
      const script = `#!/bin/sh
# Simulated build script
echo "Starting build process..."

# Create build directory
mkdir -p /build

# Compile source
echo "Compiling source files..."
echo "main.o" > /build/main.o
echo "utils.o" > /build/utils.o

# Link
echo "Linking..."
cat /build/main.o /build/utils.o > /build/app

# Run tests
echo "Running tests..."
for test in unit integration e2e
do
  echo "Running $test tests..."
  if echo "$test" | grep "e2e" >/dev/null; then
    echo "  $test: PASSED"
  else
    echo "  $test: PASSED"
  fi
done

echo "Build complete!"
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/build.sh', script, 'file');
      const result = await shell.run('sh /build.sh');

      expect(result.stdout).toContain('Starting build process');
      expect(result.stdout).toContain('Compiling source files');
      expect(result.stdout).toContain('Linking');
      expect(result.stdout).toContain('Running tests');
      expect(result.stdout).toContain('unit tests');
      expect(result.stdout).toContain('integration tests');
      expect(result.stdout).toContain('e2e tests');
      expect(result.stdout).toContain('Build complete');
      expect(result.code).toBe(0);
    });
  });

  describe('Edge Cases', () => {
    test('empty script should complete without error', async () => {
      const script = `#!/bin/sh
# Just comments
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.code).toBe(0);
      expect(result.stdout).toBe('');
    });

    test('script with only whitespace', async () => {
      const script = `#!/bin/sh


   
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.code).toBe(0);
    });

    test('deeply nested control structures', async () => {
      const script = `#!/bin/sh
if echo "outer" >/dev/null; then
  for i in 1 2
  do
    if echo "$i" | grep "1" >/dev/null; then
      echo "nested if in loop: $i"
    fi
  done
fi
`;
      const shell = new StreamShell({
        projectName,
        projectId,
        unix: mockUnix,
        fileRepository: mockFileRepo,
      });

      await mockFileRepo.createFile(projectId, '/test.sh', script, 'file');
      const result = await shell.run('sh /test.sh');

      expect(result.stdout).toContain('nested if in loop: 1');
      expect(result.stdout).not.toContain('nested if in loop: 2');
      expect(result.code).toBe(0);
    });
  });
});