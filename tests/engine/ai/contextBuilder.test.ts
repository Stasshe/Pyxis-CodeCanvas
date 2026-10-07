import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAIFileContext, loadAIFileContexts } from '@/engine/ai/contextBuilder';
import { readFileContent } from '@/engine/core/fileContent';
import type { FileItem } from '@/types';

vi.mock('@/engine/core/fileContent', () => ({ readFileContent: vi.fn() }));

const readFileContentMock = vi.mocked(readFileContent);

function file(path: string): FileItem {
  return { id: path, name: path.split('/').pop() || path, path, type: 'file' };
}

describe('AI file contexts', () => {
  beforeEach(() => {
    readFileContentMock.mockReset();
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

    await expect(loadAIFileContext('/project/image.png', 'stale editor text')).rejects.toThrow(
      'Cannot add binary file to AI context: /project/image.png'
    );
  });
});
