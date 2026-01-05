jest.mock('@/engine/core/fileRepository');
import { FindCommand } from '../src/engine/cmd/global/unixOperations/find';

const now = new Date();
const mockFiles = [
  { id: '1', projectId: 'frgt', path: '/.gitignore', name: '.gitignore', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '2', projectId: 'frgt', path: '/.pyxis', name: '.pyxis', type: 'folder' as 'folder', content: '', createdAt: now, updatedAt: now },
  { id: '3', projectId: 'frgt', path: '/.pyxis/settings.json', name: 'settings.json', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '4', projectId: 'frgt', path: '/README.md', name: 'README.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '5', projectId: 'frgt', path: '/docs', name: 'docs', type: 'folder' as 'folder', content: '', createdAt: now, updatedAt: now },
  { id: '6', projectId: 'frgt', path: '/docs/docs_git-commands.md', name: 'docs_git-commands.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '7', projectId: 'frgt', path: '/docs/getting-started.md', name: 'getting-started.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '8', projectId: 'frgt', path: '/docs/unix-commands.md', name: 'unix-commands.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '9', projectId: 'frgt', path: '/src', name: 'src', type: 'folder' as 'folder', content: '', createdAt: now, updatedAt: now },
  { id: '10', projectId: 'frgt', path: '/src/index.js', name: 'index.js', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '11', projectId: 'frgt', path: '/src/math.js', name: 'math.js', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '12', projectId: 'frgt', path: '/typescript', name: 'typescript', type: 'folder' as 'folder', content: '', createdAt: now, updatedAt: now },
  { id: '13', projectId: 'frgt', path: '/typescript/hello.ts', name: 'hello.ts', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '14', projectId: 'frgt', path: '/typescript/math.ts', name: 'math.ts', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '15', projectId: 'frgt', path: '/typescript/use-math.ts', name: 'use-math.ts', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
];

// FindCommandのモック化
class TestFindCommand extends FindCommand {
  async cachedGetFilesByPrefix(prefix: string) {
    const normalizedPrefix = prefix === '' ? '/' : prefix;
    return mockFiles.filter(f => f.path.startsWith(normalizedPrefix) || normalizedPrefix === '/');
  }
  async cachedGetFile(relativePath: string) {
    return mockFiles.find(f => f.path === relativePath);
  }
  // 存在チェックをオーバーライド
  protected async exists(path: string): Promise<boolean> {
    const relativePath = this.getRelativePathFromProject(path);
    return mockFiles.some(f => f.path === relativePath || f.path.startsWith(relativePath + '/'));
  }
  protected async isDirectory(path: string): Promise<boolean> {
    const relativePath = this.getRelativePathFromProject(path);
    if (relativePath === '/' || relativePath === '') return true;
    const file = mockFiles.find(f => f.path === relativePath);
    if (file) return file.type === 'folder';
    return mockFiles.some(f => f.path.startsWith(relativePath + '/'));
  }
}

describe('FindCommand POSIX find', () => {
  it('should match README.md with -name', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-name', 'README.md']);
    expect(result).toContain('README.md');
  });

  it('should not match README.md for -name readme (case sensitive)', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-name', 'readme']);
    expect(result).not.toContain('README.md');
  });

  it('should match all .md files for -name "*.md"', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-name', '*.md']);
    expect(result).toContain('README.md');
    expect(result).toContain('docs_git-commands.md');
    expect(result).toContain('getting-started.md');
    expect(result).toContain('unix-commands.md');
  });

  it('should match with -iname (case insensitive)', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-iname', 'readme.md']);
    expect(result).toContain('README.md');
  });

  it('should filter by -type f (files only)', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-type', 'f', '-name', '*.ts']);
    expect(result).toContain('hello.ts');
    expect(result).toContain('math.ts');
    expect(result).toContain('use-math.ts');
    // ディレクトリそのものが結果に含まれていないことを確認
    // （パスに含まれるのはOK）
    const lines = result.split('\n').map(l => l.trim()).filter(l => l);
    expect(lines.every(l => l.endsWith('.ts'))).toBe(true);
  });

  it('should filter by -type d (directories only)', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-type', 'd']);
    expect(result).toContain('docs');
    expect(result).toContain('src');
    expect(result).toContain('typescript');
    expect(result).not.toContain('README.md');
  });

  it('should support OR with -o', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-name', '*.js', '-o', '-name', '*.ts']);
    expect(result).toContain('index.js');
    expect(result).toContain('math.js');
    expect(result).toContain('hello.ts');
    expect(result).toContain('math.ts');
  });

  it('should support NOT with !', async () => {
    const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const result = await find.execute(['.', '-type', 'f', '!', '-name', '*.md']);
    expect(result).not.toContain('README.md');
    expect(result).toContain('index.js');
    expect(result).toContain('hello.ts');
  });
});
