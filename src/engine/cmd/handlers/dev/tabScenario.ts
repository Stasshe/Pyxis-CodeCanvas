/**
 * タブ操作テスト用コマンド
 *
 * 各種タブタイプを即座に開いてテストできる。
 */

import type { DevCommandContext, DevCommandInfo } from './types';

import { useTabStore } from '@/stores/tabStore';

/**
 * Diffタブをテストデータで開く
 */
async function openTestDiffTab(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { writeOutput } = context;

  const { openTab } = useTabStore.getState();

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
 * 編集可能なDiffタブを開く
 */
async function openEditableDiffTab(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { projectId, writeOutput } = context;

  if (!projectId) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  const { openTab } = useTabStore.getState();

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
 * 複数ファイルのDiffタブを開く
 */
async function openMultiFileDiffTab(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { writeOutput } = context;

  const { openTab } = useTabStore.getState();

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
 * Welcomeタブを開く
 */
async function openWelcomeTab(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { writeOutput } = context;

  const { openTab } = useTabStore.getState();

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
 * 設定タブを開く
 */
async function openSettingsTab(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { writeOutput } = context;
  const settingsType = args[0] || 'general';

  const { openTab } = useTabStore.getState();

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
 * 現在開いているタブ一覧を表示
 */
async function listTabs(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { writeOutput } = context;

  const { panes, globalActiveTab } = useTabStore.getState();

  await writeOutput('=== Open Tabs ===\n');

  const printPane = async (pane: any, indent = 0) => {
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

  if (panes.length === 0 || panes.every((p: any) => (!p.tabs || p.tabs.length === 0) && !p.children)) {
    await writeOutput('No tabs open.');
  }
}

/**
 * エクスポートするコマンド一覧
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
];
