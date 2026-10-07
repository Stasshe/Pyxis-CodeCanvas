import { getTestFs, resetTestFs } from '@tests/_helpers/testFs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsClient } from '@/engine/core/fs';
import { DiffTabType } from '@/engine/tabs/builtins/DiffTabType';
import { EditorTabType } from '@/engine/tabs/builtins/EditorTabType';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { setCurrentProject } from '@/stores/projectStore';
import { getTabContent, isTabDirty, setTabContent } from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';

const rootPath = '/tmp/workspace';

describe('tabActions.openTab', () => {
  beforeAll(() => {
    tabRegistry.register(EditorTabType);
    tabRegistry.register(DiffTabType);
  });

  beforeEach(async () => {
    resetTestFs();
    await getTestFs().mkdir(rootPath);
    tabActions.setPanes([{ id: 'pane', tabs: [], activeTabId: '' }]);
    tabState.activePane = 'pane';
    setCurrentProject({ rootPath, name: 'workspace', updatedAt: new Date() });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    tabActions.setPanes([]);
    tabState.activePane = null;
    setCurrentProject(null);
  });

  it('reads the current file when opening path-only file metadata', async () => {
    const path = `${rootPath}/index.js`;
    await getTestFs().writeFile(path, 'console.log("ready")');

    await tabActions.openTab({ path, name: 'index.js' });

    const tab = tabState.panes[0].tabs[0];
    expect(tab.content).toBe('console.log("ready")');
    expect(getTabContent(tab.id)).toBe('console.log("ready")');
  });

  it('preserves explicitly supplied empty content without reading the filesystem', async () => {
    const readText = vi.spyOn(fsClient, 'readText');

    await tabActions.openTab({ path: `${rootPath}/new.js`, name: 'new.js', content: '' });

    expect(readText).not.toHaveBeenCalled();
    expect(tabState.panes[0].tabs[0].content).toBe('');
  });

  it('does not create an empty editable tab when reading a file fails', async () => {
    const path = `${rootPath}/index.js`;
    await getTestFs().writeFile(path, 'keep this content');
    vi.spyOn(fsClient, 'readFile').mockRejectedValue(new Error('read failed'));

    await expect(tabActions.openTab({ path, name: 'index.js' })).rejects.toThrow('read failed');

    expect(tabState.panes[0].tabs).toHaveLength(0);
  });

  it('does not create an editable tab for a directory path', async () => {
    const path = `${rootPath}/folder`;
    await getTestFs().mkdir(path);

    await expect(tabActions.openTab({ path, name: 'folder' })).rejects.toThrow(
      'path is not a file'
    );

    expect(tabState.panes[0].tabs).toHaveLength(0);
  });

  it('does not split a pane when reading the new file fails', async () => {
    const path = `${rootPath}/index.js`;
    await getTestFs().writeFile(path, 'keep this content');
    vi.spyOn(fsClient, 'readFile').mockRejectedValue(new Error('read failed'));

    await expect(
      tabActions.splitPaneAndOpenFile('pane', 'horizontal', { path, name: 'index.js' }, 'after')
    ).rejects.toThrow('read failed');

    expect(tabState.panes).toHaveLength(1);
    expect(tabState.panes[0].children).toBeUndefined();
  });

  it('refreshes a reused diff with the latest payload while keeping its ID', async () => {
    const path = `${rootPath}/README-refresh.md`;
    const firstDiff = {
      formerFullPath: path,
      formerCommitId: 'HEAD',
      latterFullPath: path,
      latterCommitId: 'WORKDIR',
      formerContent: 'before commit',
      latterContent: 'first working copy',
    };
    await tabActions.openTab(
      { files: firstDiff, editable: true },
      { kind: 'diff', searchAllPanesForReuse: true }
    );
    const firstTab = tabState.panes[0].tabs[0];
    expect(firstTab.kind).toBe('diff');
    setTabContent(firstTab.id, 'stale cached working copy', false);

    const freshDiff = {
      ...firstDiff,
      formerContent: 'committed content',
      latterContent: 'working copy after terminal edit',
    };
    await tabActions.openTab({ files: freshDiff, editable: true }, { kind: 'diff' });

    const reusedTab = tabState.panes[0].tabs[0];
    expect(reusedTab.id).toBe(firstTab.id);
    expect(reusedTab.kind).toBe('diff');
    if (reusedTab.kind !== 'diff') return;
    expect(reusedTab.diffs[0]).toEqual(freshDiff);
    expect(reusedTab.editable).toBe(true);
    expect(getTabContent(firstTab.id)).toBe(freshDiff.latterContent);
    expect(isTabDirty(firstTab.id)).toBe(false);
  });

  it('preserves unsaved content when reopening a dirty diff', async () => {
    const path = `${rootPath}/README-dirty.md`;
    const originalDiff = {
      formerFullPath: path,
      formerCommitId: 'HEAD',
      latterFullPath: path,
      latterCommitId: 'WORKDIR',
      formerContent: 'before',
      latterContent: 'initial working copy',
    };
    await tabActions.openTab(
      { files: originalDiff, editable: true },
      { kind: 'diff', searchAllPanesForReuse: true }
    );
    const tab = tabState.panes[0].tabs[0];
    setTabContent(tab.id, 'unsaved editor content', true);

    await tabActions.openTab(
      { files: { ...originalDiff, latterContent: 'new working copy' }, editable: false },
      { kind: 'diff', searchAllPanesForReuse: true }
    );

    const reusedTab = tabState.panes[0].tabs[0];
    expect(reusedTab.kind).toBe('diff');
    if (reusedTab.kind !== 'diff') return;
    expect(reusedTab.diffs[0]).toEqual(originalDiff);
    expect(reusedTab.editable).toBe(true);
    expect(getTabContent(tab.id)).toBe('unsaved editor content');
    expect(isTabDirty(tab.id)).toBe(true);
  });
});
