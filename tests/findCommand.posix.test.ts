jest.mock('@/engine/core/fileRepository');
import { FindCommand } from '../src/engine/cmd/global/unixOperations/find';

const now = new Date();
const mockFiles = [
  { id: '1', projectId: 'frgt', path: '/projects/frgt/.gitignore', name: '.gitignore', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '2', projectId: 'frgt', path: '/projects/frgt/.pyxis', name: '.pyxis', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '3', projectId: 'frgt', path: '/projects/frgt/.pyxis/settings.json', name: 'settings.json', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '4', projectId: 'frgt', path: '/projects/frgt/README.md', name: 'README.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '5', projectId: 'frgt', path: '/projects/frgt/docs', name: 'docs', type: 'folder' as 'folder', content: '', createdAt: now, updatedAt: now },
  { id: '6', projectId: 'frgt', path: '/projects/frgt/docs/docs_git-commands.md', name: 'docs_git-commands.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '7', projectId: 'frgt', path: '/projects/frgt/docs/getting-started.md', name: 'getting-started.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '8', projectId: 'frgt', path: '/projects/frgt/docs/unix-commands.md', name: 'unix-commands.md', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '9', projectId: 'frgt', path: '/projects/frgt/src', name: 'src', type: 'folder' as 'folder', content: '', createdAt: now, updatedAt: now },
  { id: '10', projectId: 'frgt', path: '/projects/frgt/src/index.js', name: 'index.js', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '11', projectId: 'frgt', path: '/projects/frgt/src/math.js', name: 'math.js', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '12', projectId: 'frgt', path: '/projects/frgt/typescript/hello.ts', name: 'hello.ts', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '13', projectId: 'frgt', path: '/projects/frgt/typescript/math.ts', name: 'math.ts', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
  { id: '14', projectId: 'frgt', path: '/projects/frgt/typescript/use-math.ts', name: 'use-math.ts', type: 'file' as 'file', content: '', createdAt: now, updatedAt: now },
];

// FindCommandのモック化
class TestFindCommand extends FindCommand {
  async cachedGetFilesByPrefix(prefix: string) {
    return mockFiles.filter(f => f.path.startsWith(prefix));
  }
  async cachedGetFile(relativePath: string) {
    return mockFiles.find(f => f.path === relativePath);
  }
  // protectedメソッドをpublicでラップ
  public testFindFiles(startPath: string, criteria: any) {
    return this.findFiles(startPath, criteria);
  }
  public testParseExpressions(expressions: string[]) {
    return this.parseExpressions(expressions);
  }
}

describe('FindCommand POSIX find -name', () => {
  it('should only match README.md', async () => {
  const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
  const criteria = find.testParseExpressions(['-name', 'README.md']);
  const result = await find.testFindFiles('/', criteria);
  expect(result).toEqual(['/projects/frgt/README.md']);
  });

  it('should not match README.md for -name readme', async () => {
  const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
  const criteria = find.testParseExpressions(['-name', 'readme']);
  const result = await find.testFindFiles('/', criteria);
  expect(result).toEqual([]);
  });

  it('should match all .md files for -name "*.md"', async () => {
  const find = new TestFindCommand('frgt', '/projects/frgt', 'frgt');
    const criteria = find.testParseExpressions(['-name', '*.md']);
    const result = await find.testFindFiles('/', criteria);
    const expected = [
      '/projects/frgt/README.md',
      '/projects/frgt/docs/docs_git-commands.md',
      '/projects/frgt/docs/getting-started.md',
      '/projects/frgt/docs/unix-commands.md',
    ];
    expect(result.sort()).toEqual(expected.sort());
  });
});
