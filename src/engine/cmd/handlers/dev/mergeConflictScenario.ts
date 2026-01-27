/**
 * Merge Conflict Scenario Commands
 *
 * Create merge conflict states for testing purposes.
 * Opens the resolution tab with generated test data.
 */

import type { DevCommandContext, DevCommandInfo } from './types';

import type { MergeConflictFileEntry } from '@/engine/tabs/types';
import { tabActions } from '@/stores/tabState';

/**
 * Generate sample merge conflict data
 */
function generateSampleConflict(filePath: string): MergeConflictFileEntry {
  const fileName = filePath.split('/').pop() || 'sample.ts';

  // Base (common ancestor) content
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

  // OURS (current branch) content - modified greet function
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

  // THEIRS (branch being merged) content - modified add function
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

  // Initial resolved content (based on OURS)
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
 * Create merge conflict scenario and open tab
 */
async function createMergeConflict(args: string[], context: DevCommandContext): Promise<void> {
  const { projectName, projectId, writeOutput } = context;

  if (!projectId || !projectName) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  await writeOutput('Creating merge conflict scenario...\n');

  // Generate conflict files
  const conflictFiles: MergeConflictFileEntry[] = [];

  // Default file paths, or paths specified in args
  const filePaths =
    args.length > 0
      ? args
      : ['/src/utils/helpers.ts', '/src/components/Button.tsx', '/src/config.ts'];

  for (const path of filePaths) {
    const conflict = generateSampleConflict(path);
    conflictFiles.push(conflict);
    await writeOutput(`  Created conflict for: ${path}`);
  }

  // Open merge-conflict tab
    const { openTab } = tabActions;

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
 * Open merge conflict tab with existing data
 */
async function openMergeConflictTab(args: string[], context: DevCommandContext): Promise<void> {
  const { projectName, projectId, writeOutput } = context;

  if (!projectId || !projectName) {
    await writeOutput('Error: No active project. Please open a project first.');
    return;
  }

  // Simple single-file conflict
  const conflict = generateSampleConflict('/test/conflict.ts');

    const { openTab } = tabActions;

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
 * Create complex merge conflict scenario
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

  // Generate multiple conflict types
  const conflicts: MergeConflictFileEntry[] = [
    // TypeScript file
    generateSampleConflict('/src/services/api.ts'),
    // React component
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
    // Config file
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

  // Initialize resolvedContent with oursContent
  for (const conflict of conflicts) {
    if (!conflict.resolvedContent) {
      conflict.resolvedContent = conflict.oursContent;
    }
  }

    const { openTab } = tabActions;

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
 * Exported commands
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
