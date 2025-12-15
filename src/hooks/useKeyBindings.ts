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

'use client'

import { useEffect, useState, useCallback } from 'react'

import { DEFAULT_BINDINGS } from './defaultKeybindings'
import {
  formatKeyEvent,
  normalizeKeyCombo,
  formatKeyComboForDisplay,
  Binding,
} from './keybindingUtils'

import { storageService, STORES } from '@/engine/storage'

const KEYBINDINGS_STORAGE_ID = 'user-keybindings'

/**
 * グローバルキーバインディング管理
 */
class KeyBindingsManager {
  private bindings: Binding[] = DEFAULT_BINDINGS
  private actions = new Map<string, Set<() => void>>()
  private listeners = new Set<() => void>()
  private isInitialized = false
  private initPromise: Promise<void> | null = null
  // chord support
  private pendingChord: string | null = null

  async init(): Promise<void> {
    if (this.isInitialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      try {
        const saved = await storageService.get<Binding[]>(
          STORES.KEYBINDINGS,
          KEYBINDINGS_STORAGE_ID
        )
        if (saved && Array.isArray(saved)) {
          // Merge saved bindings with DEFAULT_BINDINGS
          // Preserve user customizations for existing bindings
          // Add new default bindings that don't exist in saved
          const savedIds = new Set(saved.map(b => b.id))
          const newBindings = DEFAULT_BINDINGS.filter(b => !savedIds.has(b.id))

          if (newBindings.length > 0) {
            console.log(
              '[KeyBindings] Found',
              newBindings.length,
              'new default bindings, merging...'
            )
            this.bindings = [...saved, ...newBindings]
            // Save merged bindings
            await storageService.set(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID, this.bindings)
          } else {
            this.bindings = saved
          }
        }
      } catch (error) {
        console.error('[KeyBindings] Failed to load keybindings:', error)
      }
      this.isInitialized = true
      this.notifyListeners()
    })()

    return this.initPromise
  }

  getBindings(): Binding[] {
    return this.bindings
  }

  async updateBindings(bindings: Binding[]): Promise<void> {
    this.bindings = bindings
    try {
      await storageService.set(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID, bindings)
    } catch (error) {
      console.error('[KeyBindings] Failed to save keybindings:', error)
    }
    this.notifyListeners()
  }

  /**
   * アクションを登録
   */
  registerAction(actionId: string, callback: () => void): () => void {
    if (!this.actions.has(actionId)) {
      this.actions.set(actionId, new Set())
    }
    this.actions.get(actionId)!.add(callback)

    return () => {
      const callbacks = this.actions.get(actionId)
      if (callbacks) {
        callbacks.delete(callback)
        if (callbacks.size === 0) {
          this.actions.delete(actionId)
        }
      }
    }
  }

  /**
   * キーイベントハンドラ
   */
  handleKeyDown(e: KeyboardEvent): boolean {
    // CRITICAL: If we're waiting for chord completion, block ALL input IMMEDIATELY
    // This must happen before formatKeyEvent to prevent keys from leaking into the editor
    // when Japanese IME is active (e.key might be "Process" or "Unidentified")
    if (this.pendingChord) {
      // Always prevent default when in pending chord state
      e.preventDefault()
      e.stopPropagation()

      const keyCombo = formatKeyEvent(e)

      // Helper: check full match for a binding (including chords)
      const matchBindingForCombo = (
        firstPart: string | null,
        secondPart: string | null
      ): Binding | null => {
        for (const b of this.bindings) {
          const normalized = normalizeKeyCombo(b.combo)
          const parts = normalized.split(/\s+/)

          // Chord binding
          if (parts.length === 2 && firstPart && secondPart) {
            // Exact match
            if (parts[0] === firstPart && parts[1] === secondPart) {
              return b
            }

            // Allow second part without modifiers (e.g., 'V' matches 'Shift+V')
            // This is intentional to support flexible chord completion
            if (parts[0] === firstPart) {
              const secondPartMain = secondPart.split('+').pop() || secondPart
              if (parts[1] === secondPartMain) {
                return b
              }
            }
          }
        }
        return null
      }

      const first = this.pendingChord
      const second = keyCombo
      const binding = keyCombo ? matchBindingForCombo(first, second) : null

      this.clearPendingChord()

      if (binding) {
        const callbacks = this.actions.get(binding.id)
        if (callbacks && callbacks.size > 0) {
          callbacks.forEach(cb => cb())
          return true
        }
      }

      // Even if no binding matched, we still blocked the input
      return true
    }

    const keyCombo = formatKeyEvent(e)

    // CRITICAL: When Japanese IME is active, e.key might be "Process" and formatKeyEvent returns empty
    // BUT if modifier keys are pressed (cmd/ctrl/alt), we must still preventDefault
    // to prevent the key from being typed into the editor
    if (!keyCombo) {
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey
      if (hasModifier) {
        // Prevent default for any key with modifiers, even if we can't identify the key
        // This prevents Japanese IME keys from leaking into the editor when shortcuts are pressed
        e.preventDefault()
        e.stopPropagation()
        return true
      }
      return false
    }

    // Check if this key starts a chord sequence
    const possibleChord = this.bindings.find(b => {
      const normalized = normalizeKeyCombo(b.combo)
      const parts = normalized.split(/\s+/)
      return parts.length === 2 && parts[0] === keyCombo
    })

    if (possibleChord) {
      this.setPendingChord(keyCombo)
      e.preventDefault()
      e.stopPropagation()
      return true
    }

    // Check for single-key binding
    const singleBinding = this.bindings.find(b => {
      const normalized = normalizeKeyCombo(b.combo)
      return normalized === keyCombo && !normalized.includes(' ')
    })

    if (singleBinding) {
      const callbacks = this.actions.get(singleBinding.id)
      if (callbacks && callbacks.size > 0) {
        e.preventDefault()
        e.stopPropagation()
        callbacks.forEach(cb => cb())
        return true
      }
    }

    return false
  }

  private setPendingChord(chord: string) {
    this.clearPendingChord()
    this.pendingChord = chord
    this.notifyListeners()
  }

  private clearPendingChord() {
    if (this.pendingChord !== null) {
      this.pendingChord = null
      this.notifyListeners()
    }
  }

  getActiveChord(): string | null {
    return this.pendingChord
  }

  clearActiveChord(): void {
    this.clearPendingChord()
  }

  /**
   * キーコンボを取得
   */
  getKeyCombo(actionId: string): string | null {
    const binding = this.bindings.find(b => b.id === actionId)
    return binding ? normalizeKeyCombo(binding.combo) : null
  }

  /**
   * リスナーを追加
   */
  addListener(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener())
  }
}

// グローバルインスタンス
const keyBindingsManager = new KeyBindingsManager()

// グローバルキーイベントリスナーの設定
if (typeof window !== 'undefined') {
  keyBindingsManager.init().catch(console.error)

  // Track whether any modifier keys are currently active.
  // This helps us block `beforeinput` events that would otherwise insert
  // characters into text inputs when modifiers (Cmd/Ctrl/Alt) are held.
  let modifierActive = false

  const onKeyDown = (e: KeyboardEvent) => {
    modifierActive = e.ctrlKey || e.metaKey || e.altKey

    const target = e.target as HTMLElement
    const isTextInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

    // If we're waiting for chord completion, ALWAYS handle the event
    // regardless of whether we're in a text input or IME state
    if (keyBindingsManager.getActiveChord()) {
      keyBindingsManager.handleKeyDown(e)
      return
    }

    // Allow shortcuts with modifiers even in text inputs
    // This includes cmd/ctrl key shortcuts even when Japanese IME is active
    const hasModifier = modifierActive

    if (isTextInput && !hasModifier) {
      return
    }

    keyBindingsManager.handleKeyDown(e)
  }

  const onKeyUp = (e: KeyboardEvent) => {
    // Update modifierActive on keyup as well (e.g., user released modifier)
    modifierActive = e.ctrlKey || e.metaKey || e.altKey
  }

  const onBeforeInput = (ev: InputEvent) => {
    // Prevent text insertion when a modifier key is active or a chord is pending.
    const target = ev.target as HTMLElement | null
    if (!target) return
    const isTextInput =
      target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable

    if (!isTextInput) return

    if (modifierActive || keyBindingsManager.getActiveChord()) {
      try {
        ev.preventDefault()
        // stopPropagation may be needed depending on environment
        ev.stopPropagation()
      } catch (err) {
        // ignore
      }
    }
  }

  window.addEventListener('keydown', onKeyDown, { capture: true })
  window.addEventListener('keyup', onKeyUp, { capture: true })
  // `beforeinput` fires just before DOM insertion; blocking it prevents characters
  // from being inserted even if key events failed to prevent them (common with IME).
  window.addEventListener('beforeinput', onBeforeInput, { capture: true })
}

/**
 * キーバインディングを使用するカスタムフック
 */
export function useKeyBindings() {
  const [bindings, setBindings] = useState<Binding[]>(keyBindingsManager.getBindings())
  const [activeChord, setActiveChord] = useState<string | null>(
    keyBindingsManager.getActiveChord?.() || null
  )

  useEffect(() => {
    keyBindingsManager.init().then(() => {
      setBindings(keyBindingsManager.getBindings())
    })

    const unsubscribe = keyBindingsManager.addListener(() => {
      setBindings(keyBindingsManager.getBindings())
      setActiveChord(keyBindingsManager.getActiveChord())
    })

    return unsubscribe
  }, [])

  const registerAction = useCallback((actionId: string, callback: () => void) => {
    return keyBindingsManager.registerAction(actionId, callback)
  }, [])

  const getKeyCombo = useCallback((actionId: string): string | null => {
    return keyBindingsManager.getKeyCombo(actionId)
  }, [])

  const updateBindings = useCallback(async (newBindings: Binding[]) => {
    await keyBindingsManager.updateBindings(newBindings)
  }, [])

  return {
    bindings,
    registerAction,
    getKeyCombo,
    updateBindings,
    activeChord,
    clearActiveChord: () => {
      keyBindingsManager.clearActiveChord()
    },
  }
}

/**
 * 特定のアクションにキーバインディングを登録する軽量フック
 */
export function useKeyBinding(
  actionId: string,
  callback: () => void,
  deps: React.DependencyList = []
) {
  const { registerAction } = useKeyBindings()

  useEffect(() => {
    const unregister = registerAction(actionId, callback)
    return unregister
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actionId, registerAction, ...deps])
}

export { formatKeyComboForDisplay }
