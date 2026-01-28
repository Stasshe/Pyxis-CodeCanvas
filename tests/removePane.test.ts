import { tabState, tabActions } from '@/stores/tabState';
import { snapshot } from 'valtio';

describe('tabActions.removePane', () => {
  beforeEach(() => {
    // reset panes
    tabState.panes = [] as any;
    tabState.activePane = null;
    tabState.globalActiveTab = null;
  });

  test('removes root pane without throwing', () => {
    tabState.panes = [
      { id: 'pane-1', tabs: [{ id: 'pane-1-tab-1', name: 'a', path: '/a' }], activeTabId: 'pane-1-tab-1' },
      { id: 'pane-2', tabs: [{ id: 'pane-2-tab-1', name: 'b', path: '/b' }], activeTabId: 'pane-2-tab-1' },
    ] as any;
    expect(() => tabActions.removePane('pane-1')).not.toThrow();
    expect(tabState.panes.length).toBe(1);
  });

  test('removes nested pane without throwing and promotes single child', () => {
    tabState.panes = [
      {
        id: 'pane-1',
        children: [
          { id: 'pane-1-1', tabs: [{ id: 't1', name: 'a', path: '/a' }], activeTabId: 't1' },
          { id: 'pane-1-2', tabs: [{ id: 't2', name: 'b', path: '/b' }], activeTabId: 't2' },
        ],
      },
    ] as any;
    expect(() => tabActions.removePane('pane-1-1')).not.toThrow();
    // Implementation promotes single remaining child to replace the parent
    expect(tabState.panes.length).toBe(1);
    expect(tabState.panes[0].id).toBe('pane-1-2');
  });

  test('does not introduce cycles in pane tree', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          { id: 'A', children: [{ id: 'B', tabs: [], activeTabId: '' }], size: 50 },
          { id: 'C', tabs: [], activeTabId: '' },
        ],
      },
    ] as any;
    expect(() => tabActions.removePane('B')).not.toThrow();

    // DFS to check cycles
    const seen = new Set();
    function dfs(p: any) {
      if (seen.has(p.id)) return;
      seen.add(p.id);
      if (p.children) for (const c of p.children) dfs(c);
    }
    tabState.panes.forEach((p: any) => dfs(p));
    expect(seen.has('B')).toBe(false);
  });

  test('clears globalActiveTab when removed', () => {
    tabState.panes = [
      { id: 'pane-1', tabs: [{ id: 't1', name: 'a', path: '/a' }], activeTabId: 't1' },
      { id: 'pane-2', tabs: [{ id: 't2', name: 'b', path: '/b' }], activeTabId: 't2' },
    ] as any;
    tabState.globalActiveTab = 't1';
    tabActions.removePane('pane-1');
    expect(tabState.globalActiveTab).toBeNull();
  });

  test('promoted child keeps correct parentId and size', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          { id: 'parent', children: [{ id: 'child', tabs: [], activeTabId: '' }], size: 30, parentId: 'root' },
        ],
      },
    ] as any;
    tabActions.removePane('parent');
    // After removal, 'child' should be promoted and have parentId equal to the original parent's parentId
    const promoted = (tabState.panes[0].children || [])[0];
    expect(promoted.id).toBe('child');
    expect(promoted.parentId).toBe('root');
    expect(promoted.size).toBe(30);
  });
});
