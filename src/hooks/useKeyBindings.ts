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

import { DEFAULT_BINDINGS } from './defaultKeybindings';
import {
  formatKeyEvent,
  normalizeKeyCombo,
  formatKeyComboForDisplay,
  Binding,
} from './keybindingUtils';

import { storageService, STORES } from '@/engine/storage';

const KEYBINDINGS_STORAGE_ID = 'user-keybindings';

// key formatting utilities are extracted to ./keybindingUtils.ts

/**
 * グローバルキーバインディング管理
 */
class KeyBindingsManager {
  private bindings: Binding[] = DEFAULT_BINDINGS;
  private actions = new Map<string, Set<() => void>>();
  private listeners = new Set<() => void>();
  private isInitialized = false;
  private initPromise: Promise<void> | null = null;
  // chord support
  private pendingChord: string | null = null; // e.g., 'Ctrl+K'
  private pendingTimeout: number | null = null;
  private readonly CHORD_TIMEOUT_MS = 3500;

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
    if (!this.actions.has(actionId)) {
      this.actions.set(actionId, new Set());
    }
    this.actions.get(actionId)!.add(callback);
    
    return () => {
      const callbacks = this.actions.get(actionId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.actions.delete(actionId);
        }
      }
    };
  }
  
  /**
   * handleKeyDown の修正版
   * pendingChord中は全てのキー入力をpreventする
   */
  
  handleKeyDown(e: KeyboardEvent): boolean {
    const keyCombo = formatKeyEvent(e);
    if (!keyCombo) return false;
  
    // Helper: check full match for a binding (including chords)
    const matchBindingForCombo = (firstPart: string | null, secondPart: string | null): Binding | null => {
      for (const b of this.bindings) {
        const normalized = normalizeKeyCombo(b.combo);
        const parts = normalized.split(/\s+/);
        if (parts.length === 1 && !firstPart && parts[0] === keyCombo) {
          return b;
        }
        if (parts.length === 2 && firstPart && secondPart) {
          if (parts[0] === firstPart && parts[1] === secondPart) return b;
          const secondPartMain = secondPart.split('+').pop() || secondPart;
          if (parts[0] === firstPart && parts[1] === secondPartMain) return b;
        }
      }
      return null;
    };
  
    // CRITICAL FIX: pendingChord存在時は必ずpreventDefault
    if (this.pendingChord) {
      const first = this.pendingChord;
      const second = keyCombo;
      const binding = matchBindingForCombo(first, second);
      
      // pendingChord状態では、マッチするかどうかに関わらず入力をブロック
      e.preventDefault();
      e.stopPropagation();
      
      this.clearPendingChord();
      
      if (binding) {
        const callbacks = this.actions.get(binding.id);
        if (callbacks && callbacks.size > 0) {
          callbacks.forEach(cb => cb());
          return true;
        }
      }
      // bindingが無くてもtrueを返す（入力をブロックした事実を返す）
      return true;
    }
  
    // chord prefix detection
    const possibleChord = this.bindings.find(
      b => normalizeKeyCombo(b.combo).split(/\s+/)[0] === keyCombo && 
           normalizeKeyCombo(b.combo).split(/\s+/).length === 2
    );
    if (possibleChord) {
      this.setPendingChord(keyCombo);
      e.preventDefault();
      e.stopPropagation();
      return true;
    }
  
    // single-key binding
    const singleBinding = this.bindings.find(
      b => normalizeKeyCombo(b.combo) === keyCombo && !b.combo.includes(' ')
    );
    if (singleBinding) {
      const callbacks = this.actions.get(singleBinding.id);
      if (callbacks && callbacks.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.forEach(cb => cb());
        return true;
      }
    }
  
    return false;
  }

    // Not a completion: check for single-key binding or start of a chord
    // First, check exact single-key binding
      // Not a completion: check if this key is the first part of any chorded binding.
      // We prioritize chord prefix detection over executing a single binding action.
      const possibleChord = this.bindings.find(b => normalizeKeyCombo(b.combo).split(/\s+/)[0] === keyCombo && normalizeKeyCombo(b.combo).split(/\s+/).length === 2);
      if (possibleChord) {
        // Enter pending chord state
        this.setPendingChord(keyCombo);
        // Do not execute any single action for now; wait for the next key
        e.preventDefault();
        e.stopPropagation();
        return true;
      }

      // If no chord prefix, check exact single-key binding
      const singleBinding = this.bindings.find(b => normalizeKeyCombo(b.combo) === keyCombo && !b.combo.includes(' '));
      if (singleBinding) {
        const callbacks = this.actions.get(singleBinding.id);
        if (callbacks && callbacks.size > 0) {
          e.preventDefault();
          e.stopPropagation();
          callbacks.forEach(cb => cb());
          return true;
        }
      }

    // No more cases; return false

    return false;
  }

  private setPendingChord(chord: string) {
    this.clearPendingChord();
    this.pendingChord = chord;
    this.notifyListeners();
    this.pendingTimeout = window.setTimeout(() => {
      // Timeout reached: if there is a single-binding for this chord, execute it
      const singleBinding = this.bindings.find(b => normalizeKeyCombo(b.combo) === chord && !b.combo.includes(' '));
      if (singleBinding) {
        const callbacks = this.actions.get(singleBinding.id);
        try {
          if (callbacks) {
            callbacks.forEach(cb => cb());
          }
        } catch (err) {
          console.error('[KeyBindings] Error executing single binding after chord timeout', err);
        }
      }
      this.clearPendingChord();
    }, this.CHORD_TIMEOUT_MS) as unknown as number;
  }

  private clearPendingChord() {
    this.pendingChord = null;
    if (this.pendingTimeout) {
      clearTimeout(this.pendingTimeout);
      this.pendingTimeout = null;
    }
    this.notifyListeners();
  }

  getActiveChord(): string | null {
    return this.pendingChord;
  }

  // Public API to clear the active chord (used by UI components)
  clearActiveChord(): void {
    this.clearPendingChord();
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
      // 入力フィールド内では通常は無効化するが、
      // Ctrl/Cmd 等の修飾キーが押されている場合はショートカットを許可する。
      // これは Monaco 等のエディターが contentEditable を使う場合でも
      // Cmd+S がブラウザの「ページを保存」に渡されるのを防ぐため。
      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // modifier が押されている場合はエディター内でもショートカットを処理する
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;

      if (isTextInput && !hasModifier) {
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
  const [activeChord, setActiveChord] = useState<string | null>(keyBindingsManager.getActiveChord?.() || null);
  const actionsRef = useRef<Map<string, () => void>>(new Map());

  // 初期化とリスナー登録
  useEffect(() => {
    keyBindingsManager.init().then(() => {
      setBindings(keyBindingsManager.getBindings());
    });

    const unsubscribe = keyBindingsManager.addListener(() => {
      setBindings(keyBindingsManager.getBindings());
      setActiveChord(keyBindingsManager.getActiveChord());
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
    activeChord,
    clearActiveChord: () => { keyBindingsManager.clearActiveChord(); },
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
