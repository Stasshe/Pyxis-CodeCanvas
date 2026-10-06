import { getTestFs, resetTestFs } from '@tests/_helpers/testFs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsClient } from '@/engine/core/fs';
import { EditorTabType } from '@/engine/tabs/builtins/EditorTabType';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import { setCurrentProject } from '@/stores/projectStore';
import { getTabContent } from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';

const rootPath = '/tmp/workspace';

describe('tabActions.openTab', () => {
  beforeAll(() => {
    tabRegistry.register(EditorTabType);
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
    vi.spyOn(fsClient, 'readText').mockRejectedValue(new Error('read failed'));

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
});
