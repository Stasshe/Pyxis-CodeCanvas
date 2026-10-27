import { describe, expect, it } from 'vitest';
import { parseGitignore } from '@/engine/core/fs/gitignore';
import { buildExecutableProjectFiles } from '@/engine/ide/run/executableFiles';
import type { FileItem } from '@/types/index';

function file(name: string, path: string, content = ''): FileItem {
  return { id: path, name, path, type: 'file', content };
}

describe('RunPanel executable files', () => {
  it('filters ignored files and directories using root gitignore rules', () => {
    const files: FileItem[] = [
      file('ignored.js', 'ignored.js'),
      {
        id: 'node_modules',
        name: 'node_modules',
        path: 'node_modules',
        type: 'folder',
        children: [file('index.js', 'node_modules/pkg/index.js')],
      },
      {
        id: 'src',
        name: 'src',
        path: 'src',
        type: 'folder',
        children: [
          file('kept.ts', 'src/kept.ts'),
          file('ignored.js', 'src/ignored.js'),
          file('notes.md', 'src/notes.md'),
        ],
      },
    ];
    const rules = parseGitignore('ignored.js\nnode_modules/');
    const result = buildExecutableProjectFiles(files, new Set(['.js', '.ts']), rules);

    expect(result.map(item => item.path)).toEqual(['src/kept.ts']);
  });
});
