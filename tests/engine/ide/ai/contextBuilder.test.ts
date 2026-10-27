import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getSelectedFileContexts,
  loadAIFileContext,
  loadAIFileContextSnapshot,
  loadAIFileContexts,
  reconcileAIFileContextsForPathChange,
  resolveAIFileSelection,
  updateSelectedFilePaths,
} from '@/engine/ide/ai/contextBuilder';
import { parseEditResponse } from '@/engine/ide/ai/responseParser';
import { readFileContent } from '@/engine/core/fileContent';
import type { FileItem } from '@/types/index';

vi.mock('@/engine/core/fileContent', () => ({ readFileContent: vi.fn() }));

const readFileContentMock = vi.mocked(readFileContent);

function file(path: string): FileItem {
  return { id: path, name: path.split('/').pop() || path, path, type: 'file' };
}

describe('AI file contexts', () => {
  beforeEach(() => {
    readFileContentMock.mockReset();
  });

  it('moves selected paths with renamed files and descendants', () => {
    const selected = [
      '/project/src/file.ts',
      '/project/src/nested/other.ts',
      '/project/src-old/untouched.ts',
    ];

    expect(
      updateSelectedFilePaths(
        selected,
        {
          type: 'rename',
          oldPath: '/project/src',
          path: '/project/lib',
        },
        '/project'
      )
    ).toEqual([
      '/project/lib/file.ts',
      '/project/lib/nested/other.ts',
      '/project/src-old/untouched.ts',
    ]);
  });

  it('removes selected paths below a deleted file or folder', () => {
    expect(
      updateSelectedFilePaths(
        ['/project/src/file.ts', '/project/src/nested/other.ts', '/project/src-old/keep.ts'],
        { type: 'delete', path: '/project/src' },
        '/project'
      )
    ).toEqual(['/project/src-old/keep.ts']);
  });

  it('remaps cached context paths and selection on rename, including descendants', () => {
    const contexts = [
      {
        path: '/project/src/file.ts',
        name: 'file.ts',
        content: 'source content',
        selected: true,
      },
      {
        path: '/project/src/nested/other.ts',
        name: 'other.ts',
        content: 'nested content',
        selected: false,
      },
    ];

    expect(
      reconcileAIFileContextsForPathChange(
        contexts,
        ['/project/src/file.ts'],
        { type: 'rename', oldPath: '/project/src', path: '/project/lib' },
        '/project'
      )
    ).toEqual({
      contexts: [
        {
          ...contexts[0],
          path: '/project/lib/file.ts',
        },
        {
          ...contexts[1],
          path: '/project/lib/nested/other.ts',
        },
      ],
      selectedPaths: ['/project/lib/file.ts'],
    });
  });

  it('removes deleted contexts so their cached content cannot be selected', () => {
    const contexts = [
      {
        path: '/project/src/file.ts',
        name: 'file.ts',
        content: 'deleted content',
        selected: true,
      },
      {
        path: '/project/docs/readme.md',
        name: 'readme.md',
        content: 'kept content',
        selected: false,
      },
    ];

    expect(
      reconcileAIFileContextsForPathChange(
        contexts,
        ['/project/src/file.ts'],
        { type: 'delete', path: '/project/src' },
        '/project'
      )
    ).toEqual({
      contexts: [contexts[1]],
      selectedPaths: [],
    });
  });

  it('leaves selection unchanged for unrelated filesystem changes', () => {
    const selected = ['/project/src/file.ts'];

    expect(
      updateSelectedFilePaths(
        selected,
        { type: 'update', path: '/project/src/file.ts' },
        '/project'
      )
    ).toBe(selected);
  });

  it('omits byte-classified binary files and preserves selection for text files', async () => {
    readFileContentMock.mockImplementation(async path => {
      if (path.endsWith('.png')) {
        return { kind: 'binary', bufferContent: new ArrayBuffer(2), mimeType: 'image/png' };
      }
      return { kind: 'text', content: 'source text' };
    });

    const contexts = await loadAIFileContexts(
      [
        {
          id: '/project/src',
          name: 'src',
          path: '/project/src',
          type: 'folder',
          children: [file('/project/src/image.png'), file('/project/src/readme.md')],
        },
      ],
      new Map([['/project/src/readme.md', true]])
    );

    expect(contexts).toEqual([
      {
        path: '/project/src/readme.md',
        name: 'readme.md',
        content: 'source text',
        selected: true,
      },
    ]);
  });

  it('refuses to add an active binary file to AI context', async () => {
    readFileContentMock.mockResolvedValue({ kind: 'binary', bufferContent: new ArrayBuffer(1) });

    await expect(loadAIFileContext('/project/image.png')).rejects.toThrow(
      'Cannot add binary file to AI context: /project/image.png'
    );
  });

  it('keeps complete source snapshots when applying edits after line 400', async () => {
    const source = Array.from({ length: 405 }, (_, index) => `line ${index + 1}`).join('\n');
    readFileContentMock.mockResolvedValue({ kind: 'text', content: source });

    const contexts = await loadAIFileContexts([file('/project/long.txt')], new Map());
    const selected = getSelectedFileContexts([{ ...contexts[0], selected: true }]);
    const response = [
      '### File: /project/long.txt',
      '<<<<<<< SEARCH',
      'line 402',
      '=======',
      'updated line 402',
      '>>>>>>> REPLACE',
    ].join('\n');
    const parsed = parseEditResponse(response, selected, '/project');

    expect(selected[0].content).toBe(source);
    expect(selected[0].content).not.toContain('// ...');
    expect(parsed.changedFiles[0].originalContent).toBe(source);
    expect(parsed.changedFiles[0].suggestedContent.split('\n')).toHaveLength(405);
    expect(parsed.changedFiles[0].suggestedContent).toContain('line 405');
    expect(parsed.changedFiles[0].suggestedContent).not.toContain('// ...');
  });
  it('keeps unaffected initial contexts when a renamed file read fails', async () => {
    const revisions = new Map<string, number>();
    let rejectRead!: (error: Error) => void;
    const oldRead = new Promise<never>((_resolve, reject) => {
      rejectRead = reject;
    });
    readFileContentMock.mockImplementation(path => {
      if (path === '/project/old.ts') return oldRead;
      return Promise.resolve({ kind: 'text', content: 'kept source' });
    });
    const pending = loadAIFileContextSnapshot(
      [file('/project/old.ts'), file('/project/keep.ts')],
      path => revisions.get(path) ?? 0
    );
    revisions.set('/project/old.ts', 1);
    rejectRead(new Error('file renamed'));
    await expect(pending).resolves.toEqual([
      { path: '/project/keep.ts', name: 'keep.ts', content: 'kept source', selected: false },
    ]);
  });

  it('excludes initial bytes superseded by a completed refresh', async () => {
    const revisions = new Map<string, number>();
    let resolveRead!: (file: { kind: 'text'; content: string }) => void;
    readFileContentMock.mockReturnValue(
      new Promise(resolve => {
        resolveRead = resolve;
      })
    );
    const pending = loadAIFileContextSnapshot(
      [file('/project/source.ts')],
      path => revisions.get(path) ?? 0
    );
    revisions.set('/project/source.ts', 1);
    resolveRead({ kind: 'text', content: 'stale initial bytes' });
    await expect(pending).resolves.toEqual([]);
  });
  it('replaces the destination cached context when rename overwrites a file', () => {
    const contexts = [
      { path: '/project/source.ts', name: 'source.ts', content: 'source bytes', selected: true },
      {
        path: '/project/destination.ts',
        name: 'destination.ts',
        content: 'overwritten bytes',
        selected: false,
      },
    ];
    const result = reconcileAIFileContextsForPathChange(
      contexts,
      ['/project/source.ts'],
      { type: 'rename', oldPath: '/project/source.ts', path: '/project/destination.ts' },
      '/project'
    );
    expect(result.contexts).toEqual([
      {
        path: '/project/destination.ts',
        name: 'destination.ts',
        content: 'source bytes',
        selected: true,
      },
    ]);
  });

  it('loads actual file bytes when selection supplies metadata only', async () => {
    readFileContentMock.mockResolvedValue({ kind: 'text', content: 'actual selected bytes' });
    await expect(loadAIFileContext('/project/source.ts')).resolves.toMatchObject({
      path: '/project/source.ts',
      content: 'actual selected bytes',
      selected: true,
    });
  });
  it('retains local selection across a render with stale persisted paths while selected bytes refresh', async () => {
    let resolveRead!: (file: { kind: 'text'; content: string }) => void;
    readFileContentMock.mockReturnValue(
      new Promise(resolve => {
        resolveRead = resolve;
      })
    );
    const cached = [
      { path: '/project/source.ts', name: 'source.ts', content: 'old bytes', selected: true },
    ];
    const pendingSelection = cached
      .filter(context => context.selected)
      .map(context => context.path);
    const refresh = loadAIFileContexts([file('/project/source.ts')], new Map());

    const renderedSelection = resolveAIFileSelection([], pendingSelection);
    resolveRead({ kind: 'text', content: 'updated bytes' });
    const refreshedContexts = (await refresh).map(context => ({
      ...context,
      selected: renderedSelection.includes(context.path),
    }));

    expect(getSelectedFileContexts(refreshedContexts)).toEqual([
      { path: '/project/source.ts', content: 'updated bytes' },
    ]);
    const acknowledged = ['/project/source.ts'];
    expect(resolveAIFileSelection(acknowledged, pendingSelection)).toBe(acknowledged);
  });
});
