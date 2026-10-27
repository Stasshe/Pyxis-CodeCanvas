import { getTestFs, resetTestFs } from '@tests/_helpers/testFs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fsClient } from '@/engine/core/fs/index';
import { BinaryTabType } from '@/components/tabs/builtins/BinaryTabType';
import { DiffTabType } from '@/components/tabs/builtins/DiffTabType';
import { EditorTabType } from '@/components/tabs/builtins/EditorTabType';
import { WelcomeTabType } from '@/components/tabs/builtins/WelcomeTabType';
import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import { setCurrentProject } from '@/stores/projectStore';
import {
  getTabContent,
  isTabDirty,
  setTabContent,
  tabContentStore,
} from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';

const rootPath = '/tmp/workspace';

describe('tabActions.openTab', () => {
  beforeAll(() => {
    tabRegistry.register(EditorTabType);
    tabRegistry.register(DiffTabType);
    tabRegistry.register(BinaryTabType);
    tabRegistry.register(WelcomeTabType);
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

  it('applies explicit editor choices to reused tabs and ignores default preferences', async () => {
    const path = `${rootPath}/editor-mode.js`;
    await getTestFs().writeFile(path, 'saved content');
    await tabActions.openTab(
      { path, name: 'editor-mode.js' },
      { kind: 'editor', editorMode: 'monaco' }
    );

    const firstTab = tabState.panes[0].tabs[0];
    if (firstTab.kind !== 'editor') throw new Error('expected an editor tab');
    const unsavedContent = 'unsaved content';
    firstTab.isDirty = true;
    setTabContent(firstTab.id, unsavedContent, true);

    await tabActions.openTab(
      { path, name: 'editor-mode.js' },
      { kind: 'editor', editorMode: 'codemirror' }
    );

    const codeMirrorTab = tabState.panes[0].tabs[0];
    expect(codeMirrorTab.id).toBe(firstTab.id);
    expect(codeMirrorTab.kind).toBe('editor');
    if (codeMirrorTab.kind !== 'editor') throw new Error('expected an editor tab');
    expect(codeMirrorTab.isCodeMirror).toBe(true);
    expect(getTabContent(firstTab.id)).toBe(unsavedContent);
    expect(isTabDirty(firstTab.id)).toBe(true);

    await tabActions.openTab(
      { path, name: 'editor-mode.js', isCodeMirror: false },
      { kind: 'editor' }
    );
    const preferenceReopenedTab = tabState.panes[0].tabs[0];
    expect(preferenceReopenedTab.id).toBe(firstTab.id);
    expect(preferenceReopenedTab.kind === 'editor' && preferenceReopenedTab.isCodeMirror).toBe(
      true
    );
    expect(getTabContent(firstTab.id)).toBe(unsavedContent);

    await tabActions.openTab(
      { path, name: 'editor-mode.js' },
      { kind: 'editor', editorMode: 'monaco' }
    );
    const monacoTab = tabState.panes[0].tabs[0];
    expect(monacoTab.id).toBe(firstTab.id);
    expect(monacoTab.kind === 'editor' && monacoTab.isCodeMirror).toBe(false);
    expect(getTabContent(firstTab.id)).toBe(unsavedContent);
    expect(isTabDirty(firstTab.id)).toBe(true);

    await tabActions.openTab(
      { path, name: 'editor-mode.js', isCodeMirror: true },
      { kind: 'editor' }
    );
    const defaultPreferenceTab = tabState.panes[0].tabs[0];
    expect(defaultPreferenceTab.id).toBe(firstTab.id);
    expect(defaultPreferenceTab.kind === 'editor' && defaultPreferenceTab.isCodeMirror).toBe(false);
  });

  it('applies an explicit editor choice when reusing a tab from another pane', async () => {
    const path = `${rootPath}/other-pane.js`;
    await getTestFs().writeFile(path, 'saved content');
    await tabActions.openTab(
      { path, name: 'other-pane.js' },
      { kind: 'editor', editorMode: 'monaco' }
    );
    const originalTab = tabState.panes[0].tabs[0];
    if (originalTab.kind !== 'editor') throw new Error('expected an editor tab');
    originalTab.isDirty = true;
    setTabContent(originalTab.id, 'unsaved content', true);

    tabActions.splitPane('pane', 'vertical');
    tabActions.setActivePane('pane-2');
    tabState.globalActiveTab = null;

    await tabActions.openTab(
      { path, name: 'other-pane.js' },
      { kind: 'editor', editorMode: 'codemirror', searchAllPanesForReuse: true }
    );

    const reusedTab = tabState.panes[0].children?.[0].tabs[0];
    expect(reusedTab?.id).toBe(originalTab.id);
    expect(reusedTab?.kind === 'editor' && reusedTab.isCodeMirror).toBe(true);
    expect(getTabContent(originalTab.id)).toBe('unsaved content');
    expect(isTabDirty(originalTab.id)).toBe(true);
  });

  it('preserves explicitly supplied empty content without reading the filesystem', async () => {
    const readText = vi.spyOn(fsClient, 'readText');

    await tabActions.openTab({ path: `${rootPath}/new.js`, name: 'new.js', content: '' });

    expect(readText).not.toHaveBeenCalled();
    expect(tabState.panes[0].tabs[0].content).toBe('');
  });

  it('assigns the target pane to welcome and binary tabs', async () => {
    await tabActions.openTab({ name: 'Welcome' }, { kind: 'welcome' });
    await tabActions.openTab(
      {
        path: `${rootPath}/image.bin`,
        name: 'image.bin',
        bufferContent: Uint8Array.from([0, 255, 8]).buffer,
      },
      { kind: 'binary' }
    );

    expect(tabState.panes[0].tabs.map(tab => tab.paneId)).toEqual(['pane', 'pane']);
  });

  it('updates a binary tab name when its file is renamed', async () => {
    const oldPath = `${rootPath}/old.bin`;
    const newPath = `${rootPath}/new.bin`;
    await tabActions.openTab(
      { path: oldPath, name: 'old.bin', bufferContent: Uint8Array.from([0, 255]).buffer },
      { kind: 'binary' }
    );

    tabActions.handleFilesRenamed(oldPath, newPath);

    expect(tabState.panes[0].tabs[0]).toMatchObject({
      path: newPath,
      name: 'new.bin',
      paneId: 'pane',
    });
  });

  it('does not create an empty editable tab when reading a file fails', async () => {
    const path = `${rootPath}/index.js`;
    await getTestFs().writeFile(path, 'keep this content');
    vi.spyOn(fsClient, 'readFile').mockRejectedValue(new Error('read failed'));

    await expect(tabActions.openTab({ path, name: 'index.js' })).rejects.toThrow('read failed');

    expect(tabState.panes[0].tabs).toHaveLength(0);
  });

  it('does not add a file from an old workspace after its read completes', async () => {
    const path = `${rootPath}/index.js`;
    await getTestFs().writeFile(path, 'workspace A content');
    const contentIdsBefore = Object.keys(tabContentStore.contents);
    let releaseRead: () => void = () => {};
    let signalReadStarted: () => void = () => {};
    const readStarted = new Promise<void>(resolve => {
      signalReadStarted = resolve;
    });
    const readReleased = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    vi.spyOn(fsClient, 'readFile').mockImplementation(async () => {
      signalReadStarted();
      await readReleased;
      return new TextEncoder().encode('workspace A content');
    });

    const opening = tabActions.openTab({ path, name: 'index.js' });
    await readStarted;

    setCurrentProject({ rootPath: '/workspace/b', name: 'workspace B', updatedAt: new Date() });
    tabState.sessionGeneration += 1;
    tabActions.setPanes([
      {
        id: 'pane-b',
        tabs: [],
        activeTabId: '',
      },
    ]);
    tabState.activePane = 'pane-b';
    releaseRead();
    await opening;

    expect(tabState.panes).toEqual([{ id: 'pane-b', tabs: [], activeTabId: '' }]);
    expect(Object.keys(tabContentStore.contents)).toEqual(contentIdsBefore);
  });

  it('does not apply a reused-tab read after the workspace session changes', async () => {
    const path = `${rootPath}/shared.js`;
    await getTestFs().writeFile(path, 'workspace A content');
    const tab = EditorTabType.createTab(
      { path, name: 'shared.js', content: 'workspace A content' },
      { paneId: 'pane' }
    );
    tabActions.setPanes([{ id: 'pane', tabs: [tab], activeTabId: tab.id }]);
    setTabContent(tab.id, 'workspace A content', false);

    let releaseRead: () => void = () => {};
    let signalReadStarted: () => void = () => {};
    const readStarted = new Promise<void>(resolve => {
      signalReadStarted = resolve;
    });
    const readReleased = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    vi.spyOn(fsClient, 'readFile').mockImplementation(async () => {
      signalReadStarted();
      await readReleased;
      return new TextEncoder().encode('workspace A content');
    });

    const opening = tabActions.openTab({ path, name: 'shared.js', content: 'provided' });
    await readStarted;

    setCurrentProject({ rootPath: '/workspace/b', name: 'workspace B', updatedAt: new Date() });
    tabState.sessionGeneration += 1;
    const reopenedTab = { ...tab, content: 'workspace B session content' };
    tabActions.setPanes([{ id: 'pane-b', tabs: [reopenedTab], activeTabId: tab.id }]);
    setTabContent(tab.id, 'workspace B session content', false);
    releaseRead();
    await opening;

    expect(getTabContent(tab.id)).toBe('workspace B session content');
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

  it('does not overwrite a pane that was split while the file was loading', async () => {
    const path = `${rootPath}/index.js`;
    await getTestFs().writeFile(path, 'opened after pane changed');
    const contentIdsBefore = Object.keys(tabContentStore.contents);
    let releaseRead: () => void = () => {};
    let signalReadStarted: () => void = () => {};
    const readStarted = new Promise<void>(resolve => {
      signalReadStarted = resolve;
    });
    const readReleased = new Promise<void>(resolve => {
      releaseRead = resolve;
    });
    vi.spyOn(fsClient, 'readFile').mockImplementation(async () => {
      signalReadStarted();
      await readReleased;
      return new TextEncoder().encode('opened after pane changed');
    });

    const opening = tabActions.splitPaneAndOpenFile(
      'pane',
      'horizontal',
      { path, name: 'index.js' },
      'after'
    );
    await readStarted;

    tabActions.splitPane('pane', 'vertical');
    const splitPaneTree = tabState.panes;
    const activePane = tabState.activePane;
    releaseRead();
    await opening;

    expect(tabState.panes).toEqual(splitPaneTree);
    expect(tabState.panes[0].children?.map(child => child.id)).toEqual(['pane-1', 'pane-2']);
    expect(tabState.activePane).toBe(activePane);
    expect(Object.keys(tabContentStore.contents)).toEqual(contentIdsBefore);
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
