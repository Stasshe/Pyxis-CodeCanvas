/**
 * Tab Operation Test Commands
 *
 * Open various tab types with test data for quick testing.
 */

import type { DevCommandContext, DevCommandInfo } from './types';

import type { EditorPane, Tab } from '@/engine/tabs/types';
import { setTabContent } from '@/stores/tabContentStore';
import { tabActions, tabState } from '@/stores/tabState';

/**
 * Open diff tab with test data
 */
async function openTestDiffTab(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;

  const { openTab } = tabActions;

  const originalContent = `function hello(name) {
  console.log("Hello, " + name);
}

hello("World");
`;

  const modifiedContent = `function hello(name: string): void {
  console.log(\`Hello, \${name}!\`);
}

function goodbye(name: string): void {
  console.log(\`Goodbye, \${name}!\`);
}

hello("World");
goodbye("World");
`;

  await openTab(
    {
      files: [
        {
          formerFullPath: '/test/sample.js',
          formerCommitId: 'abc1234',
          latterFullPath: '/test/sample.ts',
          latterCommitId: 'def5678',
          formerContent: originalContent,
          latterContent: modifiedContent,
        },
      ],
      editable: false,
    },
    {
      kind: 'diff',
    }
  );

  await writeOutput('✓ Diff tab opened with test data.');
}

/**
 * Open editable diff tab
 */
async function openEditableDiffTab(args: string[], context: DevCommandContext): Promise<void> {
  const { projectId, writeOutput } = context;

  if (!projectId) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  const { openTab } = tabActions;

  const originalContent = `// Original content
const message = "Hello";
console.log(message);
`;

  const modifiedContent = `// Modified content - you can edit this
const message = "Hello, World!";
const greeting = "Welcome!";
console.log(message, greeting);
`;

  await openTab(
    {
      files: [
        {
          formerFullPath: '/test/editable.ts',
          formerCommitId: 'HEAD~1',
          latterFullPath: '/test/editable.ts',
          latterCommitId: 'working',
          formerContent: originalContent,
          latterContent: modifiedContent,
        },
      ],
      editable: true,
    },
    {
      kind: 'diff',
    }
  );

  await writeOutput('✓ Editable diff tab opened.');
  await writeOutput('  You can edit the right side of the diff.');
}

/**
 * Open multi-file diff tab
 */
async function openMultiFileDiffTab(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;

  const { openTab } = tabActions;

  const files = [
    {
      formerFullPath: '/src/index.ts',
      formerCommitId: 'main',
      latterFullPath: '/src/index.ts',
      latterCommitId: 'feature',
      formerContent: 'export const VERSION = "1.0.0";',
      latterContent: 'export const VERSION = "2.0.0";\nexport const NAME = "MyApp";',
    },
    {
      formerFullPath: '/src/config.ts',
      formerCommitId: 'main',
      latterFullPath: '/src/config.ts',
      latterCommitId: 'feature',
      formerContent: 'export const API_URL = "http://localhost:3000";',
      latterContent: 'export const API_URL = "https://api.production.com";',
    },
    {
      formerFullPath: '/package.json',
      formerCommitId: 'main',
      latterFullPath: '/package.json',
      latterCommitId: 'feature',
      formerContent: '{\n  "name": "my-app",\n  "version": "1.0.0"\n}',
      latterContent:
        '{\n  "name": "my-app",\n  "version": "2.0.0",\n  "description": "My awesome app"\n}',
    },
  ];

  await openTab(
    {
      files,
      editable: false,
    },
    {
      kind: 'diff',
    }
  );

  await writeOutput(`✓ Multi-file diff tab opened with ${files.length} files.`);
}

/**
 * Open welcome tab
 */
async function openWelcomeTab(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;

  const { openTab } = tabActions;

  await openTab(
    {
      path: 'welcome',
      name: 'Welcome',
    },
    {
      kind: 'welcome',
    }
  );

  await writeOutput('✓ Welcome tab opened.');
}

/**
 * Open settings tab
 */
async function openSettingsTab(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;
  const settingsType = args[0] || 'general';

  const { openTab } = tabActions;

  await openTab(
    {
      path: `settings:${settingsType}`,
      name: 'Settings',
      settingsType,
    },
    {
      kind: 'settings',
    }
  );

  await writeOutput(`✓ Settings tab opened (type: ${settingsType}).`);
}

/**
 * List all open tabs
 */
async function listTabs(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;

  const { panes, globalActiveTab } = {
    panes: tabState.panes,
    globalActiveTab: tabState.globalActiveTab,
  };

  await writeOutput('=== Open Tabs ===\n');

  const printPane = async (pane: EditorPane, indent = 0) => {
    const prefix = '  '.repeat(indent);

    if (pane.tabs && pane.tabs.length > 0) {
      await writeOutput(`${prefix}Pane: ${pane.id} (${pane.tabs.length} tabs)`);
      for (const tab of pane.tabs) {
        const isActive = tab.id === globalActiveTab ? ' [ACTIVE]' : '';
        const isDirty = tab.isDirty ? ' [*]' : '';
        await writeOutput(`${prefix}  - [${tab.kind}] ${tab.name}${isDirty}${isActive}`);
        await writeOutput(`${prefix}    id: ${tab.id}`);
        if (tab.path) {
          await writeOutput(`${prefix}    path: ${tab.path}`);
        }
      }
    }

    if (pane.children) {
      for (const child of pane.children) {
        await printPane(child, indent + 1);
      }
    }
  };

  for (const pane of panes) {
    await printPane(pane);
  }

  if (panes.length === 0 || panes.every(p => (!p.tabs || p.tabs.length === 0) && !p.children)) {
    await writeOutput('No tabs open.');
  }
}

function createReproEditorTab(paneId: string, path: string, content: string): Tab {
  const name = path.split('/').pop() || path;
  const id = `${path}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  setTabContent(id, content, false);

  return {
    id,
    name,
    path,
    kind: 'editor',
    paneId,
    content,
    isDirty: false,
  };
}

function collectTabStateIssues() {
  const panes = tabState.panes as EditorPane[];
  const activePane = tabState.activePane;
  const globalActiveTab = tabState.globalActiveTab;

  const issues: string[] = [];
  const paneIdCounts = new Map<string, number>();
  const panesById = new Map<string, EditorPane[]>();
  const leafPanes: EditorPane[] = [];
  const tabLocations = new Map<string, Array<{ paneId: string; tab: Tab }>>();

  const visit = (pane: EditorPane, parentId: string | null, path: string) => {
    paneIdCounts.set(pane.id, (paneIdCounts.get(pane.id) || 0) + 1);
    panesById.set(pane.id, [...(panesById.get(pane.id) || []), pane]);

    const hasChildren = (pane.children?.length || 0) > 0;
    const tabs = pane.tabs || [];

    if (hasChildren && tabs.length > 0) {
      issues.push(`Pane ${pane.id} at ${path} has both children and ${tabs.length} tabs.`);
    }

    if (hasChildren) {
      for (const child of pane.children || []) {
        if (child.parentId !== pane.id) {
          issues.push(
            `Pane ${child.id} at ${path}/${child.id} has parentId=${child.parentId || '(empty)'}, expected ${pane.id}.`
          );
        }
        visit(child, pane.id, `${path}/${child.id}`);
      }
      return;
    }

    leafPanes.push(pane);

    if (pane.activeTabId && !tabs.some(tab => tab.id === pane.activeTabId)) {
      issues.push(`Leaf pane ${pane.id} activeTabId=${pane.activeTabId} is not in its tabs.`);
    }

    for (const tab of tabs) {
      const locations = tabLocations.get(tab.id) || [];
      tabLocations.set(tab.id, [...locations, { paneId: pane.id, tab }]);

      if (tab.paneId !== pane.id) {
        issues.push(
          `Tab ${tab.id} (${tab.name}) is stored in pane ${pane.id}, but tab.paneId=${tab.paneId || '(empty)'}.`
        );
      }
    }
  };

  for (const pane of panes) {
    visit(pane, null, pane.id);
  }

  for (const [paneId, count] of paneIdCounts) {
    if (count > 1) {
      issues.push(`Duplicate pane id ${paneId} appears ${count} times.`);
    }
  }

  for (const [tabId, locations] of tabLocations) {
    if (locations.length > 1) {
      issues.push(
        `Duplicate tab id ${tabId} appears in panes ${locations.map(location => location.paneId).join(', ')}.`
      );
    }
  }

  if (activePane) {
    const activeMatches = panesById.get(activePane) || [];
    if (activeMatches.length === 0) {
      issues.push(`activePane=${activePane} does not exist.`);
    } else if (!leafPanes.some(pane => pane.id === activePane)) {
      issues.push(`activePane=${activePane} is not a leaf pane.`);
    }
  }

  if (globalActiveTab && !tabLocations.has(globalActiveTab)) {
    issues.push(`globalActiveTab=${globalActiveTab} does not exist in any leaf pane.`);
  }

  return {
    panes,
    activePane,
    globalActiveTab,
    issues,
    leafPanes,
    tabCount: Array.from(tabLocations.values()).reduce((sum, v) => sum + v.length, 0),
  };
}

/**
 * Check tab/pane tree invariants.
 */
async function checkTabState(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;
  const { panes, activePane, globalActiveTab, issues, leafPanes, tabCount } =
    collectTabStateIssues();

  await writeOutput('=== Tab State Check ===');
  await writeOutput(`Root panes: ${panes.length}`);
  await writeOutput(`Leaf panes: ${leafPanes.length}`);
  await writeOutput(`Tabs: ${tabCount}`);
  await writeOutput(`activePane: ${activePane || '(none)'}`);
  await writeOutput(`globalActiveTab: ${globalActiveTab || '(none)'}`);

  if (issues.length === 0) {
    await writeOutput('\n✓ No tab/pane invariant issues found.');
    return;
  }

  await writeOutput(`\nFound ${issues.length} issue(s):`);
  for (const issue of issues) {
    await writeOutput(`- ${issue}`);
  }
}

/**
 * Reproduce the splitPaneAndMoveTab pane-id collision without drag-and-drop.
 */
async function reproSplitIdCollision(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;

  const first = createReproEditorTab('pane-2', '/repro/a.ts', 'export const a = 1;\n');
  const second = createReproEditorTab('pane-2', '/repro/b.ts', 'export const b = 2;\n');

  tabActions.setPanes([
    {
      id: 'pane-2',
      tabs: [first, second],
      activeTabId: first.id,
    },
  ]);
  tabActions.activateTab('pane-2', first.id);

  await writeOutput('Prepared one leaf pane with id=pane-2.');
  await writeOutput('Calling splitPaneAndMoveTab("pane-2", "vertical", firstTab, "after").');

  tabActions.splitPaneAndMoveTab('pane-2', 'vertical', first.id, 'after');

  const { issues } = collectTabStateIssues();
  await writeOutput(`Result: ${issues.length} invariant issue(s).`);
  for (const issue of issues) {
    await writeOutput(`- ${issue}`);
  }
}

/**
 * Reproduce openTab returning early when a tab exists but no pane is active.
 */
async function reproNoFocusOpen(args: string[], context: DevCommandContext): Promise<void> {
  const { writeOutput } = context;

  const existing = createReproEditorTab(
    'pane-2',
    '/repro/existing.ts',
    'export const ok = true;\n'
  );

  tabActions.setPanes([
    {
      id: 'pane-1',
      tabs: [],
      activeTabId: '',
      size: 50,
    },
    {
      id: 'pane-2',
      tabs: [existing],
      activeTabId: existing.id,
      size: 50,
    },
  ]);
  tabActions.setActivePane(null);
  tabState.globalActiveTab = null;

  const before = tabActions.getAllTabs().length;
  await writeOutput('Prepared panes: pane-1 is empty, pane-2 has one tab, activePane is null.');
  await writeOutput('Calling openTab(...) without paneId.');

  await tabActions.openTab({
    path: '/repro/open-without-focus.ts',
    name: 'open-without-focus.ts',
    content: 'export const opened = true;\n',
  });

  const after = tabActions.getAllTabs().length;
  await writeOutput(`Tabs before: ${before}`);
  await writeOutput(`Tabs after: ${after}`);
  if (after === before) {
    await writeOutput(
      'Reproduced: openTab returned without opening because no target pane was resolved.'
    );
  } else {
    await writeOutput('Not reproduced: a tab was opened.');
  }

  const { issues } = collectTabStateIssues();
  await writeOutput(`Invariant issues after repro: ${issues.length}`);
  for (const issue of issues) {
    await writeOutput(`- ${issue}`);
  }
}

/**
 * Exported commands
 */
export const tabCommands: DevCommandInfo[] = [
  {
    name: 'tab-diff',
    description: 'Open a diff tab with test data',
    usage: 'dev tab-diff',
    handler: openTestDiffTab,
  },
  {
    name: 'tab-diff-editable',
    description: 'Open an editable diff tab',
    usage: 'dev tab-diff-editable',
    handler: openEditableDiffTab,
  },
  {
    name: 'tab-diff-multi',
    description: 'Open a multi-file diff tab',
    usage: 'dev tab-diff-multi',
    handler: openMultiFileDiffTab,
  },
  {
    name: 'tab-welcome',
    description: 'Open the welcome tab',
    usage: 'dev tab-welcome',
    handler: openWelcomeTab,
  },
  {
    name: 'tab-settings',
    description: 'Open settings tab',
    usage: 'dev tab-settings [type]',
    handler: openSettingsTab,
  },
  {
    name: 'tab-list',
    description: 'List all open tabs',
    usage: 'dev tab-list',
    handler: listTabs,
  },
  {
    name: 'tab-check',
    description: 'Check tab/pane state invariants',
    usage: 'dev tab-check',
    handler: checkTabState,
  },
  {
    name: 'tab-repro-id-collision',
    description: 'Reproduce pane id collision during split-and-move',
    usage: 'dev tab-repro-id-collision',
    handler: reproSplitIdCollision,
  },
  {
    name: 'tab-repro-no-focus-open',
    description: 'Reproduce openTab failing when no pane is active',
    usage: 'dev tab-repro-no-focus-open',
    handler: reproNoFocusOpen,
  },
];
