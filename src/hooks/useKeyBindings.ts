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
  private pendingChord: string | null = null;

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
          // Merge saved bindings with DEFAULT_BINDINGS
          // Preserve user customizations for existing bindings
          // Add new default bindings that don't exist in saved
          const savedIds = new Set(saved.map(b => b.id));
          const newBindings = DEFAULT_BINDINGS.filter(b => !savedIds.has(b.id));
          
          if (newBindings.length > 0) {
            console.log('[KeyBindings] Found', newBindings.length, 'new default bindings, merging...');
            this.bindings = [...saved, ...newBindings];
            // Save merged bindings
            await storageService.set(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID, this.bindings);
          } else {
            this.bindings = saved;
          }
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
   * キーイベントハンドラ
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    const keyCombo = formatKeyEvent(e);
    if (!keyCombo) return false;

    // Helper: check full match for a binding (including chords)
    const matchBindingForCombo = (firstPart: string | null, secondPart: string | null): Binding | null => {
      for (const b of this.bindings) {
        const normalized = normalizeKeyCombo(b.combo);
        const parts = normalized.split(/\s+/);
        
        // Single-key binding
        if (parts.length === 1 && !firstPart && parts[0] === keyCombo) {
          return b;
        }
        
        // Chord binding
        if (parts.length === 2 && firstPart && secondPart) {
          // Exact match
          if (parts[0] === firstPart && parts[1] === secondPart) {
            return b;
          }
          
          // Allow second part without modifiers (e.g., 'V' matches 'Shift+V')
          // This is intentional to support flexible chord completion
          if (parts[0] === firstPart) {
            const secondPartMain = secondPart.split('+').pop() || secondPart;
            if (parts[1] === secondPartMain) {
              return b;
            }
          }
        }
      }
      return null;
    };

    // CRITICAL: If we're waiting for chord completion, block ALL input
    if (this.pendingChord) {
      const first = this.pendingChord;
      const second = keyCombo;
      const binding = matchBindingForCombo(first, second);
      
      // Always prevent default when in pending chord state
      // This prevents keys from leaking into the editor
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
      
      // Even if no binding matched, we still blocked the input
      return true;
    }

    // Check if this key starts a chord sequence
    const possibleChord = this.bindings.find(
      b => {
        const normalized = normalizeKeyCombo(b.combo);
        const parts = normalized.split(/\s+/);
        return parts.length === 2 && parts[0] === keyCombo;
      }
    );
    
    if (possibleChord) {
      this.setPendingChord(keyCombo);
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    // Check for single-key binding
    const singleBinding = this.bindings.find(
      b => {
        const normalized = normalizeKeyCombo(b.combo);
        return normalized === keyCombo && !normalized.includes(' ');
      }
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

  private setPendingChord(chord: string) {
    this.clearPendingChord();
    this.pendingChord = chord;
    this.notifyListeners();
  }

  private clearPendingChord() {
    if (this.pendingChord !== null) {
      this.pendingChord = null;
      this.notifyListeners();
    }
  }

  getActiveChord(): string | null {
    return this.pendingChord;
  }

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

  // Track IME composition state
  let isComposing = false;
  
  window.addEventListener('compositionstart', () => {
    isComposing = true;
  }, { capture: true });
  
  window.addEventListener('compositionend', () => {
    isComposing = false;
  }, { capture: true });

  window.addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      // Skip keyboard shortcuts during IME composition
      if (isComposing) {
        return;
      }

      const target = e.target as HTMLElement;
      const isTextInput =
        target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

      // If we're waiting for chord completion, ALWAYS handle the event
      // regardless of whether we're in a text input
      if (keyBindingsManager.getActiveChord()) {
        keyBindingsManager.handleKeyDown(e);
        return;
      }

      // Allow shortcuts with modifiers even in text inputs
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
  const [activeChord, setActiveChord] = useState<string | null>(
    keyBindingsManager.getActiveChord?.() || null
  );

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

  const registerAction = useCallback((actionId: string, callback: () => void) => {
    return keyBindingsManager.registerAction(actionId, callback);
  }, []);

  const getKeyCombo = useCallback((actionId: string): string | null => {
    return keyBindingsManager.getKeyCombo(actionId);
  }, []);

  const updateBindings = useCallback(async (newBindings: Binding[]) => {
    await keyBindingsManager.updateBindings(newBindings);
  }, []);

  return {
    bindings,
    registerAction,
    getKeyCombo,
    updateBindings,
    activeChord,
    clearActiveChord: () => {
      keyBindingsManager.clearActiveChord();
    },
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

export { formatKeyComboForDisplay };
