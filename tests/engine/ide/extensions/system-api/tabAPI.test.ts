import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TabAPI } from '@/engine/ide/extensions/system-api/TabAPI';
import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import { tabActions, tabState } from '@/stores/tabState';

const extensionId = 'pyxis.binary-editor-fixture';
const tabKind = `extension:${extensionId}`;

describe('extension TabAPI', () => {
  let tabs: TabAPI;

  beforeEach(() => {
    tabRegistry.unregister(tabKind);
    tabActions.setPanes([{ id: 'pane', tabs: [], activeTabId: '' }]);
    tabState.activePane = 'pane';
    tabs = new TabAPI({ extensionId });
    tabs.registerTabType(() => null);
  });

  afterEach(() => {
    tabRegistry.unregister(tabKind);
    tabActions.setPanes([]);
    tabState.activePane = null;
  });

  it('returns and updates the canonical ID of the host-created extension tab', async () => {
    const resourcePath = '/home/pyxis/demo/docs/raw.bin';
    const tabId = tabs.createTab({
      id: resourcePath,
      title: 'Binary: raw.bin',
      data: { filePath: resourcePath },
    });

    expect(tabId).toBe(`${tabKind}:${resourcePath}`);
    await new Promise<void>(resolve => setTimeout(resolve, 0));

    const tab = tabActions.getAllTabs().find(candidate => candidate.id === tabId);
    expect(tab).toBeDefined();
    expect(tabs.updateTab(tabId, { isDirty: true })).toBe(true);
    expect(tabActions.getAllTabs().find(candidate => candidate.id === tabId)?.isDirty).toBe(true);
    expect(tabs.updateTab(tabId, { isDirty: false })).toBe(true);
    expect(tabActions.getAllTabs().find(candidate => candidate.id === tabId)?.isDirty).toBe(false);
  });

  it('allows a later activation to register a fresh component after dispose', async () => {
    const oldComponent = tabRegistry.get(tabKind)?.component;
    await tabs.dispose();

    expect(tabRegistry.has(tabKind)).toBe(false);

    const nextComponent = () => null;
    const nextActivation = new TabAPI({ extensionId });
    nextActivation.registerTabType(nextComponent);

    expect(tabRegistry.get(tabKind)?.component).toBe(nextComponent);
    expect(tabRegistry.get(tabKind)?.component).not.toBe(oldComponent);
  });

  it('does not unregister a tab type owned by another API instance', async () => {
    const otherContext = new TabAPI({ extensionId });
    const unregister = vi.spyOn(tabRegistry, 'unregister');

    await otherContext.dispose();

    expect(unregister).not.toHaveBeenCalled();
    expect(tabRegistry.has(tabKind)).toBe(true);
    unregister.mockRestore();
  });

  it('finishes disposal when a close callback throws synchronously', async () => {
    const tabId = tabs.createTab({
      id: '/home/pyxis/throwing-close-callback',
      title: 'Throwing callback',
    });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    tabs.onTabClose(tabId, () => {
      throw new Error('callback failure');
    });

    await expect(tabs.dispose()).resolves.toBeUndefined();
    expect(tabActions.getAllTabs().some(tab => tab.id === tabId)).toBe(false);
    expect(tabRegistry.has(tabKind)).toBe(false);
  });

  it('runs close callbacks once after a successful store close', async () => {
    const tabId = tabs.createTab({ id: '/home/pyxis/store-close', title: 'Store close' });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const callback = vi.fn(async () => {
      expect(tabActions.getAllTabs().some(tab => tab.id === tabId)).toBe(false);
    });
    tabs.onTabClose(tabId, callback);

    expect(tabActions.closeTab('pane', tabId)).toBe(true);
    expect(callback).toHaveBeenCalledOnce();
    expect(tabActions.closeTab('pane', tabId)).toBe(false);
    expect(callback).toHaveBeenCalledOnce();
  });

  it('does not run a close callback when a dirty tab refuses to close', async () => {
    const tabId = tabs.createTab({ id: '/home/pyxis/dirty-close', title: 'Dirty close' });
    await new Promise<void>(resolve => setTimeout(resolve, 0));
    const callback = vi.fn();
    tabs.onTabClose(tabId, callback);
    tabs.updateTab(tabId, { isDirty: true });

    expect(tabActions.closeTab('pane', tabId)).toBe(false);
    expect(callback).not.toHaveBeenCalled();
    expect(tabActions.getAllTabs().some(tab => tab.id === tabId)).toBe(true);
  });
});
