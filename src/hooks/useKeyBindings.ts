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
import {
  formatKeyEvent,
  normalizeKeyCombo,
  formatKeyComboForDisplay,
  Binding,
} from './keybindingUtils';
import { DEFAULT_BINDINGS } from './defaultKeybindings';

const KEYBINDINGS_STORAGE_ID = 'user-keybindings';

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
