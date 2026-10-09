import { describe, expect, it } from 'vitest';
import { extractFilePathsFromResponse, parseEditResponse } from '@/engine/ai/responseParser';

describe('AI response file path matching', () => {
  it('keeps POSIX filename matching case-sensitive', () => {
    const response = [
      '<AI_EDIT_CONTENT_START:/workspace/src/foo.ts>',
      'new content',
      '<AI_EDIT_CONTENT_END:/workspace/src/foo.ts>',
    ].join('\n');

    const result = parseEditResponse(
      response,
      [{ path: '/workspace/src/Foo.ts', content: 'original content' }],
      '/workspace'
    );

    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0].path).toBe('/workspace/src/foo.ts');
    expect(result.changedFiles[0].isNewFile).toBe(true);
  });

  it('resolves relative response paths against the explicit workspace root', () => {
    const response = [
      '<AI_EDIT_CONTENT_START:src/a.ts>',
      'updated content',
      '<AI_EDIT_CONTENT_END:src/a.ts>',
    ].join('\n');
    const rootPath = '/workspace';
    expect(extractFilePathsFromResponse(response, rootPath)).toEqual(['/workspace/src/a.ts']);

    const result = parseEditResponse(
      response,
      [{ path: '/workspace/src/a.ts', content: 'original content' }],
      rootPath
    );

    expect(result.changedFiles[0].path).toBe('/workspace/src/a.ts');
    expect(result.changedFiles[0].isNewFile).toBeUndefined();
    expect(result.changedFiles[0].suggestedContent).toBe('updated content');
  });

  it('applies SEARCH/REPLACE blocks to the current file content', () => {
    const response = [
      '### File: src/a.ts',
      '**Reason**: Update the value',
      '<<<<<<< SEARCH',
      'const value = 1;',
      '=======',
      'const value = 2;',
      '>>>>>>> REPLACE',
    ].join('\n');

    const result = parseEditResponse(
      response,
      [{ path: '/workspace/src/a.ts', content: 'const value = 1;' }],
      '/workspace'
    );

    expect(result.usedPatchFormat).toBe(true);
    expect(result.changedFiles).toHaveLength(1);
    expect(result.changedFiles[0].suggestedContent).toBe('const value = 2;');
    expect(result.changedFiles[0].patchBlocks).toEqual([
      { search: 'const value = 1;', replace: 'const value = 2;' },
    ]);
  });
});
