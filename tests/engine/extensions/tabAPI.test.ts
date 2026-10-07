import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TabAPI } from '@/engine/extensions/system-api/TabAPI';
import { tabRegistry } from '@/engine/tabs/TabRegistry';
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
});
