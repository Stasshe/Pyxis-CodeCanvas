import { getTestFs, resetTestFs } from '@tests/_helpers/testFs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FsChangeEvent } from '@/engine/core/fs';
import { fsClient } from '@/engine/core/fs';
import type { EditorTab } from '@/engine/tabs/types';
import { setCurrentProject } from '@/stores/projectStore';
import {
  clearTabContent,
  getBufferContent,
  getTabContent,
  setBufferContent,
  setTabContent,
} from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';
import { initTabSaveSync, removeSaveTimerForPath, setContent } from '@/stores/tabState/contentSync';

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
    let finishRead: (content: string) => void = () => {};
    vi.spyOn(fsClient, 'readText').mockImplementation(
      () =>
        new Promise(resolve => {
          finishRead = resolve;
          markStarted();
        })
    );

    onFsChange?.({ type: 'update', path });
    await started;
    setContent(path, 'local edit');
    finishRead('external edit');
    await flushMicrotasks();

    expect(getTabContent('editor-tab')).toBe('local edit');
    expect(tabState.panes[0].tabs[0].isDirty).toBe(true);
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
    await flushMicrotasks();

    expect(Array.from(new Uint8Array(getBufferContent(tab.id) as ArrayBuffer))).toEqual([
      0, 255, 8,
    ]);
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
  });
});
