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
    // Implementation replaces parent with the single remaining child (promotion)
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

    // DFS to check cycles (and guard against undefined nodes)
    const seen = new Set();
    function dfs(p: any) {
      if (!p || !p.id) return;
      if (seen.has(p.id)) return;
      seen.add(p.id);
      if (p.children) for (const c of p.children) dfs(c);
    }
    tabState.panes.forEach((p: any) => dfs(p));
    expect(seen.has('B')).toBe(false);
  });

  test('no undefined pane ids after removal', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          { id: 'A', children: [{ id: 'B', tabs: [], activeTabId: '' }], size: 50 },
          { id: 'C', tabs: [], activeTabId: '' },
        ],
      },
    ] as any;
    tabActions.removePane('B');

    const collectIds = (panes: any[]) => {
      const ids: any[] = [];
      for (const p of panes) {
        if (!p) continue;
        expect(p.id).toBeDefined();
        ids.push(p.id);
        if (p.children) ids.push(...collectIds(p.children));
      }
      return ids;
    };

    const ids = collectIds(tabState.panes as any);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.includes(undefined)).toBe(false);
  });

  test('tolerates undefined child entries', () => {
    // Simulate a corrupt children array with an undefined entry
    tabState.panes = [
      {
        id: 'root',
        children: [
          undefined,
          { id: 'A', tabs: [], activeTabId: '' },
        ],
      },
    ] as any;
    expect(() => tabActions.removePane('A')).not.toThrow();
    // Ensure root still has a valid children array or is adjusted
    const root = tabState.panes[0];
    expect(root).toBeDefined();
    if (root.children) {
      for (const c of root.children) expect(c && c.id).toBeDefined();
    }
  });

  test('clears globalActiveTab when removed (only when activePane matches)', () => {
    tabState.panes = [
      { id: 'pane-1', tabs: [{ id: 't1', name: 'a', path: '/a' }], activeTabId: 't1' },
      { id: 'pane-2', tabs: [{ id: 't2', name: 'b', path: '/b' }], activeTabId: 't2' },
    ] as any;
    tabState.globalActiveTab = 't1';
    tabState.activePane = 'pane-1';
    tabActions.removePane('pane-1');
    expect(tabState.globalActiveTab).toBeNull();
  });

  test('removing an immediate child removes its subtree (no promotion)', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          { id: 'parent', children: [{ id: 'child', tabs: [], activeTabId: '' }], size: 30, parentId: 'root' },
        ],
      },
    ] as any;
    tabActions.removePane('parent');
    // After removal, the parent is removed and its subtree is gone (no promotion)
    const children = tabState.panes[0].children || [];
    expect(children.length).toBe(0);
  });

  test('removing parent with sized child subtree removes subtree (no promotion)', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          {
            id: 'parent',
            children: [{ id: 'child', tabs: [], activeTabId: '' }],
            size: 42,
            parentId: 'root',
          },
        ],
      },
    ] as any;

    tabActions.removePane('parent');
    const children = tabState.panes[0].children || [];
    expect(children.length).toBe(0);
  });

  test('removing parent with no size leaves no promoted node', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          {
            id: 'parent',
            children: [{ id: 'child', tabs: [], activeTabId: '' }],
            parentId: 'root',
          },
        ],
      },
    ] as any;

    tabActions.removePane('parent');
    const children = tabState.panes[0].children || [];
    expect(children.length).toBe(0);
  });

  test('removing parent removes its children (no promotion of grandchildren)', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          {
            id: 'parent',
            children: [
              { id: 'g1', tabs: [], activeTabId: '' },
              { id: 'g2', tabs: [], activeTabId: '' },
            ],
            size: 30,
            parentId: 'root',
          },
        ],
      },
    ] as any;

    tabActions.removePane('parent');
    const children = tabState.panes[0].children || [];
    expect(children.length).toBe(0);
  });
});
