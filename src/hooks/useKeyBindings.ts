/**
 * Keyboard Shortcut System
 * アプリケーション全体で統一されたキーバインディング管理
 *
 * 使用例:
 * ```tsx
 * const { registerAction, getKeyCombo } = useKeyBindings();
 *
 * useEffect(() => {
 *   const unregister = registerAction('saveFile', () => {
 *     console.log('Save file!');
 *   });
 *   return unregister;
 * }, []);
 * ```
 */

'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { storageService, STORES } from '@/engine/storage';
import { formatKeyEvent, normalizeKeyCombo, formatKeyComboForDisplay } from './keybindingUtils';

export type Binding = {
  id: string;
  name: string;
  combo: string; // "Ctrl+S" or "Cmd+S" etc.
  category?: string;
};

const KEYBINDINGS_STORAGE_ID = 'user-keybindings';

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
  { id: 'gitCommit', name: 'Git Commit', combo: 'Ctrl+Enter', category: 'git' },
  { id: 'gitPush', name: 'Git Push', combo: 'Ctrl+Shift+P', category: 'git' },
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

// key formatting utilities are extracted to ./keybindingUtils.ts

/**
 * グローバルキーバインディング管理
 */
class KeyBindingsManager {
  private bindings: Binding[] = DEFAULT_BINDINGS;
  private actions = new Map<string, () => void>();
  private listeners = new Set<() => void>();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;

  async init(): Promise<void> {
    if (this.isInitialized) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const saved = await storageService.get<Binding[]>(
          STORES.KEYBINDINGS,
          KEYBINDINGS_STORAGE_ID
        );
        if (saved && Array.isArray(saved)) {
          this.bindings = saved;
        }
      } catch (error) {
        console.error('[KeyBindings] Failed to load keybindings:', error);
      }
      this.isInitialized = true;
      this.notifyListeners();
    })();

    return this.initPromise;
  }

  getBindings(): Binding[] {
    return this.bindings;
  }

  async updateBindings(bindings: Binding[]): Promise<void> {
    this.bindings = bindings;
    try {
      await storageService.set(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID, bindings);
    } catch (error) {
      console.error('[KeyBindings] Failed to save keybindings:', error);
    }
    this.notifyListeners();
  }

  /**
   * アクションを登録
   */
  registerAction(actionId: string, callback: () => void): () => void {
    this.actions.set(actionId, callback);
    return () => {
      this.actions.delete(actionId);
    };
  }

  /**
   * キーイベントハンドラ
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    const keyCombo = formatKeyEvent(e);
    if (!keyCombo) return false;

    // マッチするバインディングを探す
    const binding = this.bindings.find(b => normalizeKeyCombo(b.combo) === keyCombo);
    if (!binding) return false;

    // 対応するアクションを実行
    const action = this.actions.get(binding.id);
    if (action) {
      e.preventDefault();
      e.stopPropagation();
      action();
      return true;
    }

    return false;
  }

  /**
   * キーコンボを取得
   */
  getKeyCombo(actionId: string): string | null {
    const binding = this.bindings.find(b => b.id === actionId);
    return binding ? normalizeKeyCombo(binding.combo) : null;
  }

  /**
   * リスナーを追加
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }
}

// グローバルインスタンス
const keyBindingsManager = new KeyBindingsManager();

// グローバルキーイベントリスナーの設定
if (typeof window !== 'undefined') {
  keyBindingsManager.init().catch(console.error);

  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      // 入力フィールド内では無効化
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      keyBindingsManager.handleKeyDown(e);
    },
    { capture: true }
  );
}

/**
 * キーバインディングを使用するカスタムフック
 */
export function useKeyBindings() {
  const [bindings, setBindings] = useState<Binding[]>(keyBindingsManager.getBindings());
  const actionsRef = useRef<Map<string, () => void>>(new Map());

  // 初期化とリスナー登録
  useEffect(() => {
    keyBindingsManager.init().then(() => {
      setBindings(keyBindingsManager.getBindings());
    });

    const unsubscribe = keyBindingsManager.addListener(() => {
      setBindings(keyBindingsManager.getBindings());
    });

    return unsubscribe;
  }, []);

  /**
   * アクションを登録
   */
  const registerAction = useCallback((actionId: string, callback: () => void) => {
    return keyBindingsManager.registerAction(actionId, callback);
  }, []);

  /**
   * キーコンボを取得
   */
  const getKeyCombo = useCallback((actionId: string): string | null => {
    return keyBindingsManager.getKeyCombo(actionId);
  }, []);

  /**
   * バインディングを更新
   */
  const updateBindings = useCallback(async (newBindings: Binding[]) => {
    await keyBindingsManager.updateBindings(newBindings);
  }, []);

  return {
    bindings,
    registerAction,
    getKeyCombo,
    updateBindings,
  };
}

/**
 * 特定のアクションにキーバインディングを登録する軽量フック
 */
export function useKeyBinding(
  actionId: string,
  callback: () => void,
  deps: React.DependencyList = []
) {
  const { registerAction } = useKeyBindings();

  useEffect(() => {
    const unregister = registerAction(actionId, callback);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId, registerAction, ...deps]);
}

// re-export display formatter from utils
export { formatKeyComboForDisplay };
