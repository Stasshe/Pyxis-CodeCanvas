import { STORES, storageService } from '@/engine/core/metadata/index';
import { DEFAULT_BINDINGS } from './defaultKeybindings';
import {
  type Binding,
  formatKeyComboForDisplay,
  formatKeyEvent,
  normalizeKeyCombo,
} from './keyCombo';

const KEYBINDINGS_STORAGE_ID = 'user-keybindings';
type QuickInputAction = 'quickOpen' | 'openProject' | 'openRecent';
const quickInputShortcuts = new WeakMap<HTMLElement, (action: QuickInputAction) => void>();

function isQuickInputAction(action: string): action is QuickInputAction {
  return action === 'quickOpen' || action === 'openProject' || action === 'openRecent';
}

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
            console.log(
              '[KeyBindings] Found',
              newBindings.length,
              'new default bindings, merging...'
            );
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
    this.actions.get(actionId)?.add(callback);

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
   * 外部からアクションを直接呼び出す（例: UIからの保存ボタン経由）
   */
  triggerAction(actionId: string) {
    const callbacks = this.actions.get(actionId);
    if (callbacks && callbacks.size > 0) {
      callbacks.forEach(cb => {
        try {
          cb();
        } catch (err) {
          console.error('[KeyBindings] triggerAction callback failed', err);
        }
      });
    }
  }

  /**
   * キーイベントハンドラ
   */
  handleKeyDown(
    e: KeyboardEvent,
    bindings = this.bindings,
    quickInputAction?: (action: QuickInputAction) => void,
    suppressActions = false
  ): boolean {
    // CRITICAL: If we're waiting for chord completion, block ALL input IMMEDIATELY
    // This must happen before formatKeyEvent to prevent keys from leaking into the editor
    // when Japanese IME is active (e.key might be "Process" or "Unidentified")
    if (this.pendingChord) {
      // Always prevent default when in pending chord state
      e.preventDefault();
      e.stopPropagation();

      const keyCombo = formatKeyEvent(e);

      // Helper: check full match for a binding (including chords)
      const matchBindingForCombo = (
        firstPart: string | null,
        secondPart: string | null
      ): Binding | null => {
        for (const b of bindings) {
          const normalized = normalizeKeyCombo(b.combo);
          const parts = normalized.split(/\s+/);

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

      const first = this.pendingChord;
      const second = keyCombo;
      const binding = keyCombo ? matchBindingForCombo(first, second) : null;

      this.clearPendingChord();

      if (binding) {
        if (suppressActions) return true;
        if (quickInputAction && isQuickInputAction(binding.id)) {
          quickInputAction(binding.id);
          return true;
        }
        const callbacks = this.actions.get(binding.id);
        if (callbacks && callbacks.size > 0) {
          callbacks.forEach(cb => {
            cb();
          });
          return true;
        }
      }

      // Even if no binding matched, we still blocked the input
      return true;
    }

    const keyCombo = formatKeyEvent(e);

    // CRITICAL: When Japanese IME is active, e.key might be "Process" and formatKeyEvent returns empty
    // BUT if modifier keys are pressed (cmd/ctrl/alt), we must still preventDefault
    // to prevent the key from being typed into the editor
    if (!keyCombo) {
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey;
      if (hasModifier) {
        // Prevent default for any key with modifiers, even if we can't identify the key
        // This prevents Japanese IME keys from leaking into the editor when shortcuts are pressed
        e.preventDefault();
        e.stopPropagation();
        return true;
      }
      return false;
    }

    // Check if this key starts a chord sequence
    const possibleChord = bindings.find(b => {
      const normalized = normalizeKeyCombo(b.combo);
      const parts = normalized.split(/\s+/);
      return parts.length === 2 && parts[0] === keyCombo;
    });

    if (possibleChord) {
      this.setPendingChord(keyCombo);
      e.preventDefault();
      e.stopPropagation();
      return true;
    }

    // Check for single-key binding
    const singleBinding = bindings.find(b => {
      const normalized = normalizeKeyCombo(b.combo);
      return normalized === keyCombo && !normalized.includes(' ');
    });

    if (singleBinding) {
      if (suppressActions || (quickInputAction && isQuickInputAction(singleBinding.id))) {
        e.preventDefault();
        e.stopPropagation();
        if (!suppressActions && quickInputAction && isQuickInputAction(singleBinding.id)) {
          quickInputAction(singleBinding.id);
        }
        return true;
      }
      const callbacks = this.actions.get(singleBinding.id);
      if (callbacks && callbacks.size > 0) {
        e.preventDefault();
        e.stopPropagation();
        callbacks.forEach(cb => {
          cb();
        });
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
    this.listeners.forEach(listener => {
      listener();
    });
  }
}

// グローバルインスタンス
export const keyBindingsManager = new KeyBindingsManager();

export function registerQuickInputShortcut(
  dialog: HTMLElement,
  callback: (action: QuickInputAction) => void
): () => void {
  quickInputShortcuts.set(dialog, callback);
  return () => quickInputShortcuts.delete(dialog);
}

function getQuickInputScope(target: HTMLElement): HTMLElement | null {
  const localScope = target.closest<HTMLElement>('[data-keybinding-scope="quick-input"]');
  if (localScope) return localScope;
  return document.querySelector<HTMLElement>('[data-keybinding-scope="quick-input"]');
}

function getQuickInputBindings(): Binding[] {
  return keyBindingsManager.getBindings().filter(binding => isQuickInputAction(binding.id));
}

// グローバルキーイベントリスナーの設定
if (typeof window !== 'undefined') {
  keyBindingsManager.init().catch(console.error);

  // Track whether any modifier keys are currently active.
  // This helps us block `beforeinput` events that would otherwise insert
  // characters into text inputs when modifiers (Cmd/Ctrl/Alt) are held.
  let modifierActive = false;

  const onKeyDown = (e: KeyboardEvent) => {
    modifierActive = e.ctrlKey || e.metaKey || e.altKey;

    if (e.isComposing || e.keyCode === 229 || e.key === 'Process' || e.key === 'Unidentified') {
      keyBindingsManager.clearActiveChord();
      return;
    }

    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('.xterm')) {
      keyBindingsManager.clearActiveChord();
      return;
    }
    const isTextInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    const quickInput = getQuickInputScope(target);

    if (quickInput) {
      const bindings = getQuickInputBindings();
      const quickInputAction = quickInputShortcuts.get(quickInput);
      const suppressActions = quickInput.getAttribute('data-busy') === 'true' || !quickInputAction;

      const pendingChord = keyBindingsManager.getActiveChord();
      if (
        pendingChord &&
        !bindings.some(binding => normalizeKeyCombo(binding.combo).startsWith(`${pendingChord} `))
      ) {
        keyBindingsManager.clearActiveChord();
      }

      if (keyBindingsManager.getActiveChord()) {
        keyBindingsManager.handleKeyDown(e, bindings, quickInputAction, suppressActions);
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      const isNativeEdit =
        isTextInput &&
        (e.ctrlKey || e.metaKey) &&
        [
          'a',
          'c',
          'x',
          'v',
          'z',
          'y',
          'backspace',
          'delete',
          'arrowleft',
          'arrowright',
          'home',
          'end',
        ].includes(e.key.toLowerCase());
      if (
        isNativeEdit ||
        (e.shiftKey &&
          ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key))
      )
        return;

      keyBindingsManager.handleKeyDown(e, bindings, quickInputAction, suppressActions);
      return;
    }

    // If we're waiting for chord completion, ALWAYS handle the event
    // regardless of whether we're in a text input or IME state
    if (keyBindingsManager.getActiveChord()) {
      keyBindingsManager.handleKeyDown(e);
      return;
    }

    // Allow native clipboard shortcuts (copy/cut/paste/select all) to pass through in inputs
    const isClipboardShortcut =
      (e.ctrlKey || e.metaKey) && ['c', 'x', 'v', 'a'].includes((e.key || '').toLowerCase());

    // Allow shortcuts with modifiers even in text inputs
    // This includes cmd/ctrl key shortcuts even when Japanese IME is active
    const hasModifier = modifierActive;

    // If we're in a text input and it's a clipboard shortcut, don't intercept so native behavior works
    if (isTextInput && isClipboardShortcut) {
      return;
    }

    if (isTextInput && !hasModifier) {
      return;
    }

    keyBindingsManager.handleKeyDown(e);
  };

  const onKeyUp = (e: KeyboardEvent) => {
    // Update modifierActive on keyup as well (e.g., user released modifier)
    modifierActive = e.ctrlKey || e.metaKey || e.altKey;
  };

  const onBeforeInput = (ev: InputEvent) => {
    // Prevent text insertion when a modifier key is active or a chord is pending.
    // Exception: allow paste operations (e.g., Ctrl/Cmd+V) to proceed so clipboard paste works in inputs.
    const target = ev.target;
    if (!(target instanceof HTMLElement)) return;
    if (ev.isComposing) {
      keyBindingsManager.clearActiveChord();
      return;
    }
    const isTextInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

    if (!isTextInput) return;

    const quickInput = getQuickInputScope(target);
    const pendingChord = keyBindingsManager.getActiveChord();
    if (
      quickInput &&
      pendingChord &&
      !getQuickInputBindings().some(binding => {
        return normalizeKeyCombo(binding.combo).startsWith(`${pendingChord} `);
      })
    ) {
      keyBindingsManager.clearActiveChord();
    }

    // Always block when a chord is pending
    if (keyBindingsManager.getActiveChord()) {
      try {
        ev.preventDefault();
        ev.stopPropagation();
      } catch {
        // ignore
      }
      return;
    }

    if (quickInput) return;

    // When modifier is active, allow paste operations to proceed.
    if (modifierActive) {
      const inputType = (ev as InputEvent).inputType || '';
      if (inputType?.toString().startsWith('insertFromPaste')) {
        // allow paste
        return;
      }
      try {
        ev.preventDefault();
        // stopPropagation may be needed depending on environment
        ev.stopPropagation();
      } catch {
        // ignore
      }
    }
  };

  window.addEventListener('keydown', onKeyDown, { capture: true });
  window.addEventListener('keyup', onKeyUp, { capture: true });
  // `beforeinput` fires just before DOM insertion; blocking it prevents characters
  // from being inserted even if key events failed to prevent them (common with IME).
  window.addEventListener('beforeinput', onBeforeInput, { capture: true });

  // Allow UI components to request an explicit save via CustomEvent('pyxis-save')
  // Historically we supported CustomEvent('pyxis-save'). Prefer direct triggering via
  // exported `triggerAction` to avoid coupling to the DOM event system.
}

// Expose a programmatic API to trigger a registered action from non-hook code.
export function triggerAction(actionId: string) {
  try {
    keyBindingsManager.triggerAction(actionId);
  } catch (err) {
    console.error('[KeyBindings] triggerAction failed', err);
  }
}

export function registerAction(actionId: string, callback: () => void): () => void {
  return keyBindingsManager.registerAction(actionId, callback);
}

export { formatKeyComboForDisplay };
