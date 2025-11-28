import { Binding } from './keybindingUtils';
export const DEFAULT_BINDINGS: Binding[] = [
  // File operations
  { id: 'saveFile', name: 'Save File', combo: 'Ctrl+S', category: 'file' },
  { id: 'saveFileAs', name: 'Save File As', combo: 'Ctrl+Shift+S', category: 'file' },
  { id: 'quickOpen', name: 'Quick Open', combo: 'Ctrl+P', category: 'file' },
  { id: 'newFile', name: 'New File', combo: 'Ctrl+N', category: 'file' },

  // Search
  { id: 'globalSearch', name: 'Global Search', combo: 'Ctrl+Shift+F', category: 'search' },

  // View
  { id: 'toggleLeftSidebar', name: 'Toggle Left Sidebar', combo: 'Ctrl+B', category: 'view' },
  {
    id: 'toggleRightSidebar',
    name: 'Toggle Right Sidebar',
    combo: 'Ctrl+Shift+B',
    category: 'view',
  },
  { id: 'toggleBottomPanel', name: 'Toggle Bottom Panel', combo: 'Ctrl+J', category: 'view' },
  { id: 'openSettings', name: 'Open Settings', combo: 'Ctrl+,', category: 'view' },
  { id: 'openShortcutKeys', name: 'Open Shortcut Keys', combo: 'Ctrl+Shift+J', category: 'view' },
  { id: 'toggleWordWrap', name: 'Toggle Word Wrap', combo: 'Alt+Z', category: 'view' },
  // Tab management
  { id: 'closeTab', name: 'Close Tab', combo: 'Ctrl+Shift+Q', category: 'tab' },
  { id: 'nextTab', name: 'Next Tab', combo: 'Ctrl+E', category: 'tab' },

  // Git
  { id: 'openGit', name: 'Open Git Panel', combo: 'Ctrl+Shift+G', category: 'git' },
  // Execution
  { id: 'runFile', name: 'Open Run Panel', combo: 'Ctrl+Shift+R', category: 'execution' },
  { id: 'openTerminal', name: 'Open Terminal', combo: 'Ctrl+@', category: 'execution' },
  { id: 'runSelection', name: 'Run Selection', combo: 'Ctrl+Alt+R', category: 'execution' },

  // Additional Pyxis-specific / useful editor shortcuts
  { id: 'togglePreview', name: 'Toggle Preview', combo: 'Ctrl+K V', category: 'view' },
  // Open markdown preview in another pane (split or random other pane)
  { id: 'openMdPreview', name: 'Open Markdown Preview in Other Pane', combo: 'Ctrl+K P', category: 'view' },

  // Tabs
  { id: 'removeAllTabs', name: 'Close All Tabs', combo: 'Ctrl+K A', category: 'tab' },

  // Project
  { id: 'openProject', name: 'Open Project', combo: 'Ctrl+Shift+O', category: 'project' },
];
