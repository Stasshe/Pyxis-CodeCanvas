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
    // Parent should remain and its children should contain only the remaining child
    expect(tabState.panes.length).toBe(1);
    expect(tabState.panes[0].id).toBe('pane-1');
    expect(tabState.panes[0].children?.length).toBe(1);
    expect(tabState.panes[0].children?.[0].id).toBe('pane-1-2');
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

  test('promoted child keeps correct size when promoted', () => {
    tabState.panes = [
      {
        id: 'root',
        children: [
          { id: 'parent', children: [{ id: 'child', tabs: [], activeTabId: '' }], size: 30, parentId: 'root' },
        ],
      },
    ] as any;
    tabActions.removePane('parent');
    // After removal, 'child' should be promoted and inherit parent's size
    const promoted = (tabState.panes[0].children || [])[0];
    expect(promoted.id).toBe('child');
    expect(promoted.size).toBe(30);
  });

  test('promote multiple grandchildren into parent', () => {
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
    expect(children.map((c: any) => c.id)).toEqual(['g1', 'g2']);
    expect(children.every((c: any) => c.parentId === 'root')).toBe(true);
  });
});
