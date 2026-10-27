import { describe, expect, it } from 'vitest';
import {
  folderSearchLocation,
  isWorkspaceNameValid,
  resolveFolderInput,
  workspaceDestination,
} from '@/engine/ide/search/folderPath';
import { HOME_DIR } from '@/engine/core/fs/index';

describe('folder palette paths', () => {
  it('expands home paths and normalizes absolute paths', () => {
    expect(resolveFolderInput('~')).toBe(HOME_DIR);
    expect(resolveFolderInput('~/work/../demo')).toBe(`${HOME_DIR}/demo`);
    expect(resolveFolderInput('/tmp/work/../demo')).toBe('/tmp/demo');
  });

  it('resolves partial paths from the currently browsed directory', () => {
    expect(resolveFolderInput('workspace', `${HOME_DIR}/demo`)).toBe(`${HOME_DIR}/demo/workspace`);
    expect(folderSearchLocation('src/in', `${HOME_DIR}/demo`)).toEqual({
      directory: `${HOME_DIR}/demo/src`,
      prefix: 'in',
    });
    expect(folderSearchLocation('~/de', `${HOME_DIR}/demo`)).toEqual({
      directory: HOME_DIR,
      prefix: 'de',
    });
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
