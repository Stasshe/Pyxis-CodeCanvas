import { describe, expect, it } from 'vitest';
import {
  isWorkspaceNameValid,
  resolveFolderInput,
  workspaceDestination,
} from '@/components/Top/OperationWindow/folderPath';
import { HOME_DIR } from '@/engine/core/fs';

describe('folder palette paths', () => {
  it('expands home paths and normalizes absolute paths', () => {
    expect(resolveFolderInput('~')).toBe(HOME_DIR);
    expect(resolveFolderInput('~/work/../demo')).toBe(`${HOME_DIR}/demo`);
    expect(resolveFolderInput('/tmp/work/../demo')).toBe('/tmp/demo');
  });

  it('rejects relative paths outside the home shorthand', () => {
    expect(() => resolveFolderInput('workspace')).toThrow('absolute path');
  });

  it('shows a safe destination while the workspace name is incomplete', () => {
    expect(workspaceDestination('')).toBe(`${HOME_DIR}/<name>`);
    expect(workspaceDestination('../outside')).toBe(`${HOME_DIR}/<name>`);
    expect(workspaceDestination('  notes  ')).toBe(`${HOME_DIR}/notes`);
  });

  it('accepts one directory component and rejects traversal names', () => {
    expect(isWorkspaceNameValid('notes')).toBe(true);
    expect(isWorkspaceNameValid('folder/name')).toBe(false);
    expect(isWorkspaceNameValid('..')).toBe(false);
  });
});
