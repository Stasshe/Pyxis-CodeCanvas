import { Binding } from './keybindingUtils';

export const DEFAULT_BINDINGS: Binding[] = [
  // File operations
  { id: 'openFile', name: 'Open File', combo: 'Ctrl+O', category: 'file' },
  { id: 'saveFile', name: 'Save File', combo: 'Ctrl+S', category: 'file' },
  { id: 'saveFileAs', name: 'Save File As', combo: 'Ctrl+Shift+S', category: 'file' },
  { id: 'quickOpen', name: 'Quick Open', combo: 'Ctrl+P', category: 'file' },
  { id: 'closeFile', name: 'Close File', combo: 'Ctrl+F4', category: 'file' },
  { id: 'newFile', name: 'New File', combo: 'Ctrl+N', category: 'file' },

  // Search
  { id: 'find', name: 'Find in File', combo: 'Ctrl+F', category: 'search' },
  { id: 'findNext', name: 'Find Next', combo: 'F3', category: 'search' },
  { id: 'findPrev', name: 'Find Previous', combo: 'Shift+F3', category: 'search' },
  { id: 'replace', name: 'Replace in File', combo: 'Ctrl+H', category: 'search' },
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
  { id: 'openShortcutKeys', name: 'Open Shortcut Keys', combo: 'Ctrl+K Ctrl+S', category: 'view' },
  { id: 'zoomIn', name: 'Zoom In', combo: 'Ctrl+=', category: 'view' },
  { id: 'zoomOut', name: 'Zoom Out', combo: 'Ctrl+-', category: 'view' },
  { id: 'resetZoom', name: 'Reset Zoom', combo: 'Ctrl+0', category: 'view' },

  // Tab management
  { id: 'newTab', name: 'New Tab', combo: 'Ctrl+T', category: 'tab' },
  { id: 'closeTab', name: 'Close Tab', combo: 'Ctrl+W', category: 'tab' },
  { id: 'nextTab', name: 'Next Tab', combo: 'Ctrl+Tab', category: 'tab' },
  { id: 'prevTab', name: 'Previous Tab', combo: 'Ctrl+Shift+Tab', category: 'tab' },
  { id: 'reopenClosedTab', name: 'Reopen Closed Tab', combo: 'Ctrl+Shift+T', category: 'tab' },

  // Git
  { id: 'openGit', name: 'Open Git Panel', combo: 'Ctrl+Shift+G', category: 'git' },
  { id: 'gitCommit', name: 'Git Commit', combo: 'Ctrl+Shift+Enter', category: 'git' },
  { id: 'gitPush', name: 'Git Push', combo: 'Ctrl+Alt+Shift+P', category: 'git' },
  { id: 'gitPull', name: 'Git Pull', combo: 'Ctrl+Alt+P', category: 'git' },

  // Execution
  { id: 'runFile', name: 'Open Run Panel', combo: 'Ctrl+Shift+R', category: 'execution' },
  { id: 'openTerminal', name: 'Open Terminal', combo: 'Ctrl+`', category: 'execution' },
  { id: 'runSelection', name: 'Run Selection', combo: 'Ctrl+Enter', category: 'execution' },

  // Additional Pyxis-specific / useful editor shortcuts
  { id: 'saveAll', name: 'Save All', combo: 'Ctrl+K S', category: 'file' },
  { id: 'formatDocument', name: 'Format Document', combo: 'Shift+Alt+F', category: 'file' },
  { id: 'undo', name: 'Undo', combo: 'Ctrl+Z', category: 'edit' },
  { id: 'redo', name: 'Redo', combo: 'Ctrl+Shift+Z', category: 'edit' },
  { id: 'goToLine', name: 'Go to Line', combo: 'Ctrl+G', category: 'navigation' },
  { id: 'toggleZenMode', name: 'Toggle Zen Mode', combo: 'Ctrl+K Z', category: 'view' },
  { id: 'togglePreview', name: 'Toggle Preview', combo: 'Ctrl+K V', category: 'view' },
  { id: 'revealInFileTree', name: 'Reveal in File Tree', combo: 'Ctrl+Shift+E', category: 'view' },

  // Project
  { id: 'openProject', name: 'Open Project', combo: 'Ctrl+Shift+O', category: 'project' },
  { id: 'closeProject', name: 'Close Project', combo: 'Ctrl+Alt+F4', category: 'project' },

  // Other
  {
    id: 'showCommandPalette',
    name: 'Show Command Palette',
    combo: 'Ctrl+Shift+P',
    category: 'other',
  },
  { id: 'toggleComment', name: 'Toggle Line Comment', combo: 'Ctrl+/', category: 'other' },
  {
    id: 'toggleBlockComment',
    name: 'Toggle Block Comment',
    combo: 'Shift+Alt+A',
    category: 'other',
  },
];
