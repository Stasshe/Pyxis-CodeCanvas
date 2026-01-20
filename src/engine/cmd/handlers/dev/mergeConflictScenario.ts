/**
 * マージコンフリクトシナリオ作成コマンド
 *
 * テスト用にマージコンフリクト状態を即座に作成し、
 * 解決タブを開くことができる。
 */

import type { DevCommandContext, DevCommandInfo } from './types';

import { fileRepository } from '@/engine/core/fileRepository';
import type { MergeConflictFileEntry } from '@/engine/tabs/types';
import { useTabStore } from '@/stores/tabStore';

/**
 * サンプルのマージコンフリクトデータを生成
 */
function generateSampleConflict(filePath: string): MergeConflictFileEntry {
  const fileName = filePath.split('/').pop() || 'sample.ts';

  // ベース（共通祖先）の内容
  const baseContent = `// ${fileName}
// Version: 1.0.0

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export const VERSION = '1.0.0';
`;

  // OURS（現在のブランチ）の内容 - greet関数を変更
  const oursContent = `// ${fileName}
// Version: 1.1.0 - Feature A

export function greet(name: string, greeting: string = 'Hello'): string {
  return \`\${greeting}, \${name}!\`;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

export const VERSION = '1.1.0';
`;

  // THEIRS（マージ元ブランチ）の内容 - add関数を変更
  const theirsContent = `// ${fileName}
// Version: 1.1.0 - Feature B

export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}

export function add(a: number, b: number, c: number = 0): number {
  return a + b + c;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export const VERSION = '1.1.0';
`;

  // 初期の解決内容（OURSをベースに）
  const resolvedContent = oursContent;

  return {
    filePath,
    baseContent,
    oursContent,
    theirsContent,
    resolvedContent,
    isResolved: false,
  };
}

/**
 * マージコンフリクトシナリオを作成してタブを開く
 */
async function createMergeConflict(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { projectName, projectId, writeOutput } = context;

  if (!projectId || !projectName) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  await writeOutput('Creating merge conflict scenario...\n');

  // コンフリクトファイルの生成
  const conflictFiles: MergeConflictFileEntry[] = [];

  // デフォルトのファイルパス、または引数で指定されたパス
  const filePaths =
    args.length > 0
      ? args
      : ['/src/utils/helpers.ts', '/src/components/Button.tsx', '/src/config.ts'];

  for (const path of filePaths) {
    const conflict = generateSampleConflict(path);
    conflictFiles.push(conflict);
    await writeOutput(`  Created conflict for: ${path}`);
  }

  // merge-conflictタブを開く
  const { openTab } = useTabStore.getState();

  await openTab(
    {
      conflicts: conflictFiles,
      oursBranch: 'feature-a',
      theirsBranch: 'feature-b',
      projectId,
      projectName,
    },
    {
      kind: 'merge-conflict',
    }
  );

  await writeOutput('\n✓ Merge conflict resolution tab opened.');
  await writeOutput(`  Conflicting files: ${conflictFiles.length}`);
  await writeOutput('  Branches: feature-a ← feature-b');
}

/**
 * マージコンフリクトタブを直接開く（既存データで）
 */
async function openMergeConflictTab(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { projectName, projectId, writeOutput } = context;

  if (!projectId || !projectName) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  // シンプルな1ファイルコンフリクト
  const conflict = generateSampleConflict('/test/conflict.ts');

  const { openTab } = useTabStore.getState();

  await openTab(
    {
      conflicts: [conflict],
      oursBranch: 'main',
      theirsBranch: 'feature',
      projectId,
      projectName,
    },
    {
      kind: 'merge-conflict',
    }
  );

  await writeOutput('✓ Merge conflict tab opened with test data.');
}

/**
 * 複雑なマージコンフリクトシナリオを作成
 */
async function createComplexMergeConflict(
  args: string[],
  context: DevCommandContext
): Promise<void> {
  const { projectName, projectId, writeOutput } = context;

  if (!projectId || !projectName) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  await writeOutput('Creating complex merge conflict scenario...\n');

  // 複数の異なるタイプのコンフリクトを生成
  const conflicts: MergeConflictFileEntry[] = [
    // TypeScriptファイル
    generateSampleConflict('/src/services/api.ts'),
    // Reactコンポーネント
    {
      filePath: '/src/components/Header.tsx',
      baseContent: `import React from 'react';

export const Header: React.FC = () => {
  return (
    <header>
      <h1>My App</h1>
    </header>
  );
};
`,
      oursContent: `import React from 'react';
import { Logo } from './Logo';

export const Header: React.FC = () => {
  return (
    <header className="header">
      <Logo />
      <h1>My App - Feature A</h1>
    </header>
  );
};
`,
      theirsContent: `import React from 'react';
import { Navigation } from './Navigation';

export const Header: React.FC = () => {
  return (
    <header className="header">
      <h1>My App</h1>
      <Navigation />
    </header>
  );
};
`,
      resolvedContent: '',
      isResolved: false,
    },
    // 設定ファイル
    {
      filePath: '/config/settings.json',
      baseContent: `{
  "version": "1.0.0",
  "api": {
    "endpoint": "https://api.example.com"
  }
}
`,
      oursContent: `{
  "version": "1.1.0",
  "api": {
    "endpoint": "https://api.example.com",
    "timeout": 5000
  },
  "features": {
    "darkMode": true
  }
}
`,
      theirsContent: `{
  "version": "1.1.0",
  "api": {
    "endpoint": "https://api-v2.example.com"
  },
  "features": {
    "analytics": true
  }
}
`,
      resolvedContent: '',
      isResolved: false,
    },
  ];

  // resolvedContentをoursContentで初期化
  for (const conflict of conflicts) {
    if (!conflict.resolvedContent) {
      conflict.resolvedContent = conflict.oursContent;
    }
  }

  const { openTab } = useTabStore.getState();

  await openTab(
    {
      conflicts,
      oursBranch: 'develop',
      theirsBranch: 'feature/complex-merge',
      projectId,
      projectName,
    },
    {
      kind: 'merge-conflict',
    }
  );

  await writeOutput(`✓ Created ${conflicts.length} conflicting files:`);
  for (const c of conflicts) {
    await writeOutput(`  - ${c.filePath}`);
  }
  await writeOutput('\nMerge conflict resolution tab opened.');
}

/**
 * エクスポートするコマンド一覧
 */
export const mergeConflictCommands: DevCommandInfo[] = [
  {
    name: 'merge-conflict',
    description: 'Create a merge conflict scenario for testing',
    usage: 'dev merge-conflict [file1] [file2] ...',
    handler: createMergeConflict,
  },
  {
    name: 'merge-conflict-open',
    description: 'Open merge conflict tab with test data',
    usage: 'dev merge-conflict-open',
    handler: openMergeConflictTab,
  },
  {
    name: 'merge-conflict-complex',
    description: 'Create a complex merge conflict scenario',
    usage: 'dev merge-conflict-complex',
    handler: createComplexMergeConflict,
  },
];
