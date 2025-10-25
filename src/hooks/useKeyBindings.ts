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

export type Binding = {
  id: string;
  name: string;
  combo: string; // "Ctrl+S" or "Cmd+S" etc.
  category?: string;
};

const KEYBINDINGS_STORAGE_ID = 'user-keybindings';

export const DEFAULT_BINDINGS: Binding[] = [
  { id: 'openFile', name: 'Open File', combo: 'Ctrl+O', category: 'file' },
  { id: 'saveFile', name: 'Save File', combo: 'Ctrl+S', category: 'file' },
  { id: 'find', name: 'Find', combo: 'Ctrl+F', category: 'search' },
  { id: 'toggleSidebar', name: 'Toggle Sidebar', combo: 'Ctrl+B', category: 'view' },
  { id: 'runFile', name: 'Run File', combo: 'Ctrl+R', category: 'execution' },
  { id: 'newTab', name: 'New Tab', combo: 'Ctrl+T', category: 'tab' },
  { id: 'closeTab', name: 'Close Tab', combo: 'Ctrl+W', category: 'tab' },
  { id: 'nextTab', name: 'Next Tab', combo: 'Ctrl+Tab', category: 'tab' },
  { id: 'prevTab', name: 'Previous Tab', combo: 'Ctrl+Shift+Tab', category: 'tab' },
];

/**
 * キーイベントを正規化したキーコンボ文字列に変換
 * Mac: Cmd, Windows/Linux: Ctrl を統一的に扱う
 */
function formatKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  // Ctrl/Cmd の統一的な扱い
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  if (isMac) {
    if (e.metaKey) parts.push('Cmd');
    if (e.ctrlKey) parts.push('Ctrl'); // Macでも Ctrl キーは別扱い
  } else {
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta'); // Windows キー等
  }

  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  // 修飾キーのみは無視
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return '';

  // キーの正規化
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);

  return parts.join('+');
}

/**
 * キーコンボを正規化（Ctrl/Cmdを統一）
 */
function normalizeKeyCombo(combo: string): string {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  if (isMac) {
    // Mac: Ctrl → Cmd に変換
    return combo.replace(/^Ctrl\+/, 'Cmd+').replace(/\+Ctrl\+/, '+Cmd+');
  }
  return combo;
}

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

/**
 * キーコンボを表示用にフォーマット
 */
export function formatKeyComboForDisplay(combo: string): string {
  return normalizeKeyCombo(combo);
}
