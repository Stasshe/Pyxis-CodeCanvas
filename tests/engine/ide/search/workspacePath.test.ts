import { describe, expect, it } from 'vitest';
import { isCurrentWorkspacePath } from '@/engine/ide/search/workspacePath';

describe('isCurrentWorkspacePath', () => {
  it('rejects a result when the active workspace changes while it is loading', () => {
    expect(isCurrentWorkspacePath('/workspace/a/src/file.ts', '/workspace/a', '/workspace/b')).toBe(
      false
    );
  });

  it('rejects paths outside the workspace root', () => {
    expect(isCurrentWorkspacePath('/workspace/b/file.ts', '/workspace/a', '/workspace/a')).toBe(
      false
    );
  });

  it('accepts a path that still belongs to the requested active workspace', () => {
    expect(isCurrentWorkspacePath('/workspace/a/src/file.ts', '/workspace/a', '/workspace/a')).toBe(
      true
    );
  });
});
