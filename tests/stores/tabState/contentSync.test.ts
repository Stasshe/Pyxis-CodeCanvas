import { getTestFs, resetTestFs } from '@tests/_helpers/testFs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as monacoModels from '@/components/Tab/text-editor/hooks/useMonacoModels';
import type { FsChangeEvent } from '@/engine/core/fs';
import { fsClient } from '@/engine/core/fs';
import { DiffTabType } from '@/engine/tabs/builtins/DiffTabType';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
import type { DiffTab, EditorTab, ExtensionTab } from '@/engine/tabs/types';
import * as loggerStore from '@/stores/loggerStore';
import { setCurrentProject } from '@/stores/projectStore';
import {
  clearTabContent,
  getBufferContent,
  getTabContent,
  isTabDirty,
  setBufferContent,
  setTabContent,
} from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';
import {
  addSaveListener,
  flushDirtyTabFiles,
  initTabSaveSync,
  removeSaveTimerForPath,
  saveImmediately,
  setContent,
  updateFromExternal,
  updateTabContent,
} from '@/stores/tabState/contentSync';

const rootPath = '/tmp/app';
let onFsChange: ((event: FsChangeEvent) => void) | undefined;

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
}

function setEditorTab(path: string, id = 'editor-tab'): EditorTab {
  const tab: EditorTab = {
    id,
    name: path.split('/').at(-1) || 'file',
    kind: 'editor',
    path,
    paneId: 'pane',
    content: '',
    isDirty: false,
  };
  tabActions.setPanes([{ id: 'pane', tabs: [tab], activeTabId: id }]);
  clearTabContent(id);
  setTabContent(id, 'before', false);
  return tab;
}

describe('tab filesystem synchronization', () => {
  beforeAll(async () => {
    vi.spyOn(fsClient, 'addChangeListener').mockImplementation(listener => {
      onFsChange = listener;
      return () => {};
    });
    await initTabSaveSync();
  });

  beforeEach(async () => {
    resetTestFs();
    await getTestFs().mkdir(rootPath, { recursive: true });
    tabActions.setPanes([]);
    setCurrentProject({ rootPath, name: 'app', updatedAt: new Date() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    tabActions.setPanes([]);
  });

  it('keeps edits made while an external file read is pending', async () => {
    const path = `${rootPath}/src.ts`;
    setEditorTab(path);
    let markStarted: () => void = () => {};
    const started = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    let finishRead: (content: Uint8Array) => void = () => {};
    vi.spyOn(fsClient, 'readFile').mockImplementation(
      () =>
        new Promise(resolve => {
          finishRead = resolve;
          markStarted();
        })
    );

    onFsChange?.({ type: 'update', path });
    await started;
    setContent(path, 'local edit');
    finishRead(new TextEncoder().encode('external edit'));
    await flushMicrotasks();

    expect(getTabContent('editor-tab')).toBe('local edit');
    expect(tabState.panes[0].tabs[0].isDirty).toBe(true);
    removeSaveTimerForPath(path);
  });

  it('flushes only the latest pending model content', async () => {
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const path = `${rootPath}/src.ts`;
    const tab = setEditorTab(path);
    tab.isCodeMirror = true;
    const callbacks: Array<() => void> = [];
    const model = { content: 'before' };
    vi.stubGlobal('window', {
      requestIdleCallback: (flush: () => void) => callbacks.push(flush),
    } as unknown as Window);
    const updateModel = vi
      .spyOn(monacoModels, 'updateCachedModelContent')
      .mockImplementation((_path, content) => {
        model.content = content;
      });

    try {
      setContent(path, 'first');
      setContent(path, 'second');
      setContent(path, 'latest');
      expect(callbacks).toHaveLength(1);
      callbacks[0]?.();
      expect(updateModel).toHaveBeenCalledTimes(1);
      expect(updateModel).toHaveBeenCalledWith(path, 'latest');
      expect(model.content).toBe('latest');
    } finally {
      vi.unstubAllGlobals();
      removeSaveTimerForPath(path);
    }
  });

  it('does not apply an older external model update after Monaco input', async () => {
    const path = `${rootPath}/src.ts`;
    const tab = setEditorTab(path);
    const callbacks: Array<() => void> = [];
    vi.stubGlobal('window', {
      requestIdleCallback: (flush: () => void) => callbacks.push(flush),
    } as unknown as Window);
    const updateModel = vi.spyOn(monacoModels, 'updateCachedModelContent');

    try {
      updateFromExternal(path, 'external content');
      updateTabContent(tab.id, 'typed content', true);
      callbacks[0]?.();

      expect(updateModel).not.toHaveBeenCalledWith(path, 'external content');
      expect(getTabContent(tab.id)).toBe('typed content');
      expect(isTabDirty(tab.id)).toBe(true);
    } finally {
      vi.unstubAllGlobals();
      removeSaveTimerForPath(path);
    }
  });

  it('ignores a clean external model echo while preserving later editor dirtiness', () => {
    const path = `${rootPath}/src.ts`;
    const tab = setEditorTab(path);

    updateFromExternal(path, 'external content');
    updateTabContent(tab.id, 'external content', true);

    expect(getTabContent(tab.id)).toBe('external content');
    expect(isTabDirty(tab.id)).toBe(false);
    expect(tabActions.getTab('pane', tab.id)?.isDirty).toBe(false);

    updateTabContent(tab.id, 'user edit', true);
    updateTabContent(tab.id, 'user edit', true);

    expect(getTabContent(tab.id)).toBe('user edit');
    expect(isTabDirty(tab.id)).toBe(true);
    expect(tabActions.getTab('pane', tab.id)?.isDirty).toBe(true);
    removeSaveTimerForPath(path);
  });

  it('keeps dirty tabs open unless the close is explicitly discarded', () => {
    const path = `${rootPath}/src.ts`;
    setEditorTab(path);
    setContent(path, 'unsaved');

    expect(tabActions.closeTab('pane', 'editor-tab')).toBe(false);
    expect(tabActions.getTab('pane', 'editor-tab')).not.toBeNull();
    expect(tabActions.closeTab('pane', 'editor-tab', { discard: true })).toBe(true);
    expect(tabActions.getTab('pane', 'editor-tab')).toBeNull();
  });

  it('keeps a dirty tab after file deletion and cancels its pending autosave', async () => {
    vi.useFakeTimers();
    const path = `${rootPath}/deleted.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'unsaved edit');
    const listener = vi.fn();
    const removeListener = addSaveListener(listener);
    const log = vi.spyOn(loggerStore, 'pushLogMessage');

    try {
      await getTestFs().rm(path);
      tabActions.handleFileDeleted(path);
      await vi.advanceTimersByTimeAsync(1000);

      expect(tabActions.getTab('pane', 'editor-tab')).not.toBeNull();
      expect(getTabContent('editor-tab')).toBe('unsaved edit');
      expect(isTabDirty('editor-tab')).toBe(true);
      expect(await getTestFs().exists(path)).toBe(false);
      expect(listener).toHaveBeenCalledWith(path, false, expect.any(Error));
      expect(log).toHaveBeenCalledWith(expect.stringContaining(path), 'error', 'Editor');
    } finally {
      removeListener();
      removeSaveTimerForPath(path);
    }
  });

  it('invalidates a save before the debounced delete handler runs', async () => {
    vi.useFakeTimers();
    const path = `${rootPath}/deleted-near-save.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'unsaved edit');
    await vi.advanceTimersByTimeAsync(950);
    await getTestFs().rm(path);

    tabActions.invalidateSavesForDeletedPath(path);
    await vi.advanceTimersByTimeAsync(100);
    tabActions.handleFileDeleted(path);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await getTestFs().exists(path)).toBe(false);
    expect(tabActions.getTab('pane', 'editor-tab')).not.toBeNull();
    expect(getTabContent('editor-tab')).toBe('unsaved edit');
    expect(isTabDirty('editor-tab')).toBe(true);
    removeSaveTimerForPath(path);
  });

  it('does not recreate a deleted file when an earlier save is in preflight', async () => {
    const path = `${rootPath}/deleted-during-save.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'unsaved edit');
    let releaseExists: () => void = () => {};
    let markExistsStarted: () => void = () => {};
    const existsStarted = new Promise<void>(resolve => {
      markExistsStarted = resolve;
    });
    const existsReleased = new Promise<void>(resolve => {
      releaseExists = resolve;
    });
    vi.spyOn(fsClient, 'exists').mockImplementation(async () => {
      markExistsStarted();
      await existsReleased;
      return false;
    });

    const save = saveImmediately(path);
    await existsStarted;
    await getTestFs().rm(path);
    tabActions.handleFileDeleted(path);
    releaseExists();

    await expect(save).resolves.toBe(false);
    expect(await getTestFs().exists(path)).toBe(false);
    expect(tabActions.getTab('pane', 'editor-tab')).not.toBeNull();
    expect(getTabContent('editor-tab')).toBe('unsaved edit');
    expect(isTabDirty('editor-tab')).toBe(true);
  });

  it('closes clean deleted tabs while retaining dirty tabs in a batch', async () => {
    const dirtyPath = `${rootPath}/dirty.ts`;
    const cleanPath = `${rootPath}/clean.ts`;
    await getTestFs().writeFile(dirtyPath, 'before');
    await getTestFs().writeFile(cleanPath, 'before');
    const dirtyTab = setEditorTab(dirtyPath, 'dirty-tab');
    const cleanTab: EditorTab = {
      ...dirtyTab,
      id: 'clean-tab',
      name: 'clean.ts',
      path: cleanPath,
    };
    tabActions.setPanes([{ id: 'pane', tabs: [dirtyTab, cleanTab], activeTabId: dirtyTab.id }]);
    setTabContent(dirtyTab.id, 'before', false);
    setTabContent(cleanTab.id, 'before', false);
    setContent(dirtyPath, 'unsaved edit');
    await getTestFs().rm(dirtyPath);
    await getTestFs().rm(cleanPath);

    tabActions.handleFilesDeleted([dirtyPath, cleanPath]);

    expect(tabActions.getTab('pane', dirtyTab.id)).not.toBeNull();
    expect(tabActions.getTab('pane', cleanTab.id)).toBeNull();
    expect(getTabContent(dirtyTab.id)).toBe('unsaved edit');
    removeSaveTimerForPath(dirtyPath);
  });

  it('does not remove a dirty pane and clears its tab cache after a clean removal', () => {
    const path = `${rootPath}/src.ts`;
    setEditorTab(path);
    setContent(path, 'unsaved');
    expect(tabActions.removePane('pane')).toBe(false);

    setTabContent('editor-tab', 'saved', false);
    tabState.panes[0].tabs[0].isDirty = false;
    expect(tabActions.removePane('pane')).toBe(true);
    expect(getTabContent('editor-tab')).toBeUndefined();
  });

  it('keeps tabs with failed pending-draft saves open without writing their source file', async () => {
    const kind = 'extension:draft-test';
    const tab: ExtensionTab = {
      id: 'draft-tab',
      name: 'Draft',
      kind,
      path: `${rootPath}/src.ts`,
      paneId: 'pane',
    };
    const writeFile = vi.spyOn(fsClient, 'writeFile');
    tabRegistry.register(
      {
        kind,
        displayName: 'Draft test',
        canEdit: false,
        canPreview: false,
        component: () => null,
        createTab: () => tab,
        hasPendingChanges: () => true,
        flushPendingChanges: async () => {
          throw new Error('Draft storage unavailable');
        },
      },
      { overwrite: true }
    );
    tabActions.setPanes([{ id: 'pane', tabs: [tab], activeTabId: tab.id }]);

    try {
      expect(tabActions.closeTab('pane', tab.id)).toBe(false);
      expect(tabActions.closeTab('pane', tab.id, { discard: true })).toBe(false);
      expect(tabActions.removePane('pane')).toBe(false);
      await expect(flushDirtyTabFiles()).rejects.toThrow('Draft storage unavailable');
      expect(tabActions.getTab('pane', tab.id)).toMatchObject({ id: tab.id, path: tab.path });
      expect(writeFile).not.toHaveBeenCalled();
    } finally {
      tabRegistry.unregister(kind);
    }
  });

  it('rescans drafts edited while another tab draft is being saved', async () => {
    const kind = 'extension:draft-rescan-test';
    const tabs: ExtensionTab[] = [
      {
        id: 'first-draft',
        name: 'First draft',
        kind,
        path: `${rootPath}/first.md`,
        paneId: 'pane',
      },
      {
        id: 'second-draft',
        name: 'Second draft',
        kind,
        path: `${rootPath}/second.md`,
        paneId: 'pane',
      },
    ];
    const pending = new Set(tabs.map(tab => tab.id));
    let firstSaveCount = 0;
    let secondSaveCount = 0;
    let releaseSecond: () => void = () => {};
    let markSecondStarted: () => void = () => {};
    const secondStarted = new Promise<void>(resolve => {
      markSecondStarted = resolve;
    });
    const secondReleased = new Promise<void>(resolve => {
      releaseSecond = resolve;
    });
    tabRegistry.register(
      {
        kind,
        displayName: 'Draft rescan test',
        canEdit: false,
        canPreview: false,
        component: () => null,
        createTab: () => tabs[0],
        hasPendingChanges: tab => pending.has(tab.id),
        flushPendingChanges: async tab => {
          if (tab.id === tabs[0].id) firstSaveCount += 1;
          if (tab.id === tabs[1].id) {
            secondSaveCount += 1;
            if (secondSaveCount === 1) {
              markSecondStarted();
              await secondReleased;
            }
          }
          pending.delete(tab.id);
        },
      },
      { overwrite: true }
    );
    tabActions.setPanes([{ id: 'pane', tabs, activeTabId: tabs[0].id }]);

    try {
      const flush = flushDirtyTabFiles();
      await secondStarted;
      pending.add(tabs[0].id);
      releaseSecond();
      await flush;

      expect(pending.size).toBe(0);
      expect(firstSaveCount).toBe(2);
      expect(secondSaveCount).toBe(1);
    } finally {
      tabRegistry.unregister(kind);
    }
  });

  it('keeps an editable diff tab snapshot in sync with its content', () => {
    tabRegistry.register(DiffTabType, { overwrite: true });
    const path = `${rootPath}/src.ts`;
    const diffTab: DiffTab = {
      id: 'diff-tab',
      name: 'Diff',
      kind: 'diff',
      path,
      paneId: 'pane',
      editable: true,
      diffs: [
        {
          formerFullPath: path,
          latterFullPath: path,
          formerCommitId: 'old',
          latterCommitId: 'new',
          formerContent: 'before',
          latterContent: 'before',
        },
      ],
      isDirty: false,
    };
    tabActions.setPanes([{ id: 'pane', tabs: [diffTab], activeTabId: diffTab.id }]);
    setTabContent(diffTab.id, 'before', false);

    setContent(path, 'edited diff');

    expect((tabState.panes[0].tabs[0] as DiffTab).diffs[0].latterContent).toBe('edited diff');
    removeSaveTimerForPath(path);
  });

  it('does not read a file when an open editor already has dirty content', async () => {
    const path = `${rootPath}/src.ts`;
    setEditorTab(path);
    setContent(path, 'local edit');
    const readText = vi.spyOn(fsClient, 'readText');

    onFsChange?.({ type: 'update', path });
    await flushMicrotasks();

    expect(readText).not.toHaveBeenCalled();
    expect(getTabContent('editor-tab')).toBe('local edit');
    removeSaveTimerForPath(path);
  });

  it('refreshes binary tab buffers from file bytes', async () => {
    const path = `${rootPath}/image.bin`;
    const newBytes = new Uint8Array([0, 255, 8]);
    await getTestFs().writeFile(path, newBytes);
    const oldBuffer = Uint8Array.from([1]).buffer;
    const tab = {
      id: 'binary-tab',
      name: 'image.bin',
      kind: 'binary' as const,
      path,
      paneId: 'pane',
      content: '',
      bufferContent: oldBuffer,
    };
    tabActions.setPanes([{ id: 'pane', tabs: [tab], activeTabId: tab.id }]);
    setBufferContent(tab.id, oldBuffer);
    const readText = vi.spyOn(fsClient, 'readText');

    onFsChange?.({ type: 'update', path });
    await vi.waitFor(() => {
      expect(Array.from(new Uint8Array(getBufferContent(tab.id) as ArrayBuffer))).toEqual([
        0, 255, 8,
      ]);
    });
    expect(Array.from(new Uint8Array(tab.bufferContent as ArrayBuffer))).toEqual([0, 255, 8]);
    expect(readText).not.toHaveBeenCalled();
  });

  it('saves a pending edit at the renamed path', async () => {
    vi.useFakeTimers();
    const oldPath = `${rootPath}/old.ts`;
    const newPath = `${rootPath}/new.ts`;
    await getTestFs().writeFile(oldPath, 'before');
    setEditorTab(oldPath);
    setContent(oldPath, 'pending edit');

    await fsClient.rename(oldPath, newPath);
    tabActions.handleFilesRenamed(oldPath, newPath);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await getTestFs().readText(newPath)).toBe('pending edit');
    expect(getTabContent('editor-tab')).toBe('pending edit');
    expect(tabState.panes[0].tabs[0].name).toBe('new.ts');
  });

  it('keeps failed saves dirty and reports the filesystem error', async () => {
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'local edit');
    const error = new Error('write failed');
    const listener = vi.fn();
    const removeListener = addSaveListener(listener);
    vi.spyOn(fsClient, 'writeFile').mockRejectedValue(error);

    const saved = await saveImmediately(path);
    removeListener();

    expect(saved).toBe(false);
    expect(listener).toHaveBeenCalledWith(path, false, error);
    expect(isTabDirty('editor-tab')).toBe(true);
    expect(tabState.panes[0].tabs[0].isDirty).toBe(true);
    expect(await getTestFs().readText(path)).toBe('before');
  });

  it('clears content-store dirty state even when the tab flag is stale', async () => {
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setTabContent('editor-tab', 'restored dirty content', true);

    await flushDirtyTabFiles();

    expect(await getTestFs().readText(path)).toBe('restored dirty content');
    expect(isTabDirty('editor-tab')).toBe(false);
    expect(tabState.panes[0].tabs[0].isDirty).toBe(false);
  });

  it('refuses to replace a file that became binary after opening', async () => {
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'local edit');
    const binaryBytes = new Uint8Array([0, 255, 8]);
    await getTestFs().writeFile(path, binaryBytes);
    const writeFile = vi.spyOn(fsClient, 'writeFile');
    const listener = vi.fn();
    const removeListener = addSaveListener(listener);

    const saved = await saveImmediately(path);
    removeListener();

    expect(saved).toBe(false);
    expect(writeFile).not.toHaveBeenCalled();
    expect(listener).toHaveBeenCalledWith(path, false, expect.any(Error));
    expect(isTabDirty('editor-tab')).toBe(true);
    expect(Array.from(await getTestFs().readFile(path))).toEqual(Array.from(binaryBytes));
  });

  it('does not write a discarded tab after save preflight resumes', async () => {
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'discarded edit');
    let releaseExists: () => void = () => {};
    let markExistsStarted: () => void = () => {};
    const existsStarted = new Promise<void>(resolve => {
      markExistsStarted = resolve;
    });
    const existsReleased = new Promise<void>(resolve => {
      releaseExists = resolve;
    });
    vi.spyOn(fsClient, 'exists').mockImplementation(async () => {
      markExistsStarted();
      await existsReleased;
      return false;
    });

    const save = saveImmediately(path);
    await existsStarted;
    expect(tabActions.closeTab('pane', 'editor-tab', { discard: true })).toBe(true);
    releaseExists();

    await expect(save).resolves.toBe(false);
    expect(await getTestFs().readText(path)).toBe('before');
  });

  it('keeps edits made during a dispatched save dirty until the newer debounce saves', async () => {
    vi.useFakeTimers();
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    let releaseSave: () => void = () => {};
    let markSaveStarted: () => void = () => {};
    const saveStarted = new Promise<void>(resolve => {
      markSaveStarted = resolve;
    });
    const saveReleased = new Promise<void>(resolve => {
      releaseSave = resolve;
    });
    vi.spyOn(fsClient, 'writeFile').mockImplementation(async (filePath, content) => {
      await getTestFs().writeFile(filePath, content);
      markSaveStarted();
      await saveReleased;
    });

    setContent(path, 'first edit');
    const firstSave = saveImmediately(path);
    await saveStarted;
    setContent(path, 'newer edit');
    releaseSave();
    await expect(firstSave).resolves.toBe(true);

    expect(isTabDirty('editor-tab')).toBe(true);
    expect(getTabContent('editor-tab')).toBe('newer edit');
    await vi.advanceTimersByTimeAsync(1000);

    expect(await getTestFs().readText(path)).toBe('newer edit');
    expect(isTabDirty('editor-tab')).toBe(false);
  });

  it('flushes edits made while a close-time save is dispatched', async () => {
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    let releaseFirstWrite: () => void = () => {};
    let markFirstWriteStarted: () => void = () => {};
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve;
    });
    const firstWriteReleased = new Promise<void>(resolve => {
      releaseFirstWrite = resolve;
    });
    let writeCount = 0;
    vi.spyOn(fsClient, 'writeFile').mockImplementation(async (filePath, content) => {
      await getTestFs().writeFile(filePath, content);
      writeCount += 1;
      if (writeCount === 1) {
        markFirstWriteStarted();
        await firstWriteReleased;
      }
    });

    setContent(path, 'first edit');
    const flush = flushDirtyTabFiles();
    await firstWriteStarted;
    setContent(path, 'newer edit');
    releaseFirstWrite();
    await flush;

    expect(writeCount).toBe(2);
    expect(await getTestFs().readText(path)).toBe('newer edit');
    expect(isTabDirty('editor-tab')).toBe(false);
  });

  it('rescans other files edited while a close-time save is pending', async () => {
    const firstPath = `${rootPath}/first.ts`;
    const secondPath = `${rootPath}/second.ts`;
    await getTestFs().writeFile(firstPath, 'first before');
    await getTestFs().writeFile(secondPath, 'second before');
    const firstTab = setEditorTab(firstPath, 'first-tab');
    const secondTab: EditorTab = {
      ...firstTab,
      id: 'second-tab',
      name: 'second.ts',
      path: secondPath,
    };
    tabActions.setPanes([{ id: 'pane', tabs: [firstTab, secondTab], activeTabId: firstTab.id }]);
    setTabContent(firstTab.id, 'first before', false);
    setTabContent(secondTab.id, 'second edit', true);
    let releaseWrite: () => void = () => {};
    let markWriteStarted: () => void = () => {};
    const writeStarted = new Promise<void>(resolve => {
      markWriteStarted = resolve;
    });
    const writeReleased = new Promise<void>(resolve => {
      releaseWrite = resolve;
    });
    vi.spyOn(fsClient, 'writeFile').mockImplementation(async (filePath, content) => {
      await getTestFs().writeFile(filePath, content);
      if (filePath === secondPath) {
        markWriteStarted();
        await writeReleased;
      }
    });

    const flush = flushDirtyTabFiles();
    await writeStarted;
    setContent(firstPath, 'first edit during flush');
    releaseWrite();
    await flush;

    expect(await getTestFs().readText(firstPath)).toBe('first edit during flush');
    expect(await getTestFs().readText(secondPath)).toBe('second edit');
    expect(isTabDirty(firstTab.id)).toBe(false);
    expect(isTabDirty(secondTab.id)).toBe(false);
  });

  it('saves a pending edit after its workspace closes', async () => {
    vi.useFakeTimers();
    const path = `${rootPath}/src.ts`;
    await getTestFs().writeFile(path, 'before');
    setEditorTab(path);
    setContent(path, 'pending edit');
    tabActions.setPanes([]);
    setCurrentProject(null);

    await vi.advanceTimersByTimeAsync(1000);

    expect(await getTestFs().readText(path)).toBe('pending edit');
  });

  it('saves the latest edit at the renamed path when rename overlaps a save', async () => {
    vi.useFakeTimers();
    const oldPath = `${rootPath}/old.ts`;
    const newPath = `${rootPath}/new.ts`;
    await getTestFs().writeFile(oldPath, 'before');
    setEditorTab(oldPath);
    let releaseFirstWrite: () => void = () => {};
    let markFirstWriteStarted: () => void = () => {};
    const firstWriteStarted = new Promise<void>(resolve => {
      markFirstWriteStarted = resolve;
    });
    const firstWriteReleased = new Promise<void>(resolve => {
      releaseFirstWrite = resolve;
    });
    let writeCount = 0;
    vi.spyOn(fsClient, 'writeFile').mockImplementation(async (path, content) => {
      await getTestFs().writeFile(path, content);
      writeCount += 1;
      if (writeCount === 1) {
        markFirstWriteStarted();
        await firstWriteReleased;
      }
    });

    setContent(oldPath, 'first edit');
    const firstSave = saveImmediately(oldPath);
    await firstWriteStarted;
    setContent(oldPath, 'latest edit');
    await fsClient.rename(oldPath, newPath);
    tabActions.handleFilesRenamed(oldPath, newPath);
    releaseFirstWrite();
    await expect(firstSave).resolves.toBe(true);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await getTestFs().exists(oldPath)).toBe(false);
    expect(await getTestFs().readText(newPath)).toBe('latest edit');
    expect(tabState.panes[0].tabs[0]).toMatchObject({ path: newPath, name: 'new.ts' });
  });

  it('does not recreate the old path when rename overlaps save preflight', async () => {
    vi.useFakeTimers();
    const oldPath = `${rootPath}/old.ts`;
    const newPath = `${rootPath}/new.ts`;
    await getTestFs().writeFile(oldPath, 'before');
    setEditorTab(oldPath);
    setContent(oldPath, 'latest edit');
    let releaseExists: () => void = () => {};
    let markExistsStarted: () => void = () => {};
    const existsStarted = new Promise<void>(resolve => {
      markExistsStarted = resolve;
    });
    const existsReleased = new Promise<void>(resolve => {
      releaseExists = resolve;
    });
    vi.spyOn(fsClient, 'exists').mockImplementation(async path => {
      if (path === oldPath) {
        markExistsStarted();
        await existsReleased;
        return false;
      }
      return getTestFs().exists(path);
    });

    const save = saveImmediately(oldPath);
    await existsStarted;
    await fsClient.rename(oldPath, newPath);
    tabActions.handleFilesRenamed(oldPath, newPath);
    releaseExists();
    await expect(save).resolves.toBe(false);
    await vi.advanceTimersByTimeAsync(1000);

    expect(await getTestFs().exists(oldPath)).toBe(false);
    expect(await getTestFs().readText(newPath)).toBe('latest edit');
    expect(tabState.panes[0].tabs[0]).toMatchObject({ path: newPath, isDirty: false });
  });
});
