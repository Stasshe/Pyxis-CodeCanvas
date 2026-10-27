/**
 * React hooks for registering and observing keyboard bindings.
 */
import { useCallback, useEffect, useState } from 'react';
import type { Binding } from '@/engine/ide/keybindings/keyCombo';
import { formatKeyComboForDisplay } from '@/engine/ide/keybindings/keyCombo';
import {
  keyBindingsManager,
  registerAction,
  registerQuickInputShortcut,
  triggerAction,
} from '@/engine/ide/keybindings/manager';

export { formatKeyComboForDisplay, registerAction, registerQuickInputShortcut, triggerAction };

export function useKeyBindings() {
  const [bindings, setBindings] = useState<Binding[]>(keyBindingsManager.getBindings());
  const [activeChord, setActiveChord] = useState<string | null>(
    keyBindingsManager.getActiveChord()
  );

  useEffect(() => {
    void keyBindingsManager.init().then(() => {
      setBindings(keyBindingsManager.getBindings());
    });

    return keyBindingsManager.addListener(() => {
      setBindings(keyBindingsManager.getBindings());
      setActiveChord(keyBindingsManager.getActiveChord());
    });
  }, []);

  const register = useCallback((actionId: string, callback: () => void) => {
    return keyBindingsManager.registerAction(actionId, callback);
  }, []);
  const getKeyCombo = useCallback(
    (actionId: string) => keyBindingsManager.getKeyCombo(actionId),
    []
  );
  const updateBindings = useCallback((newBindings: Binding[]) => {
    return keyBindingsManager.updateBindings(newBindings);
  }, []);
  const clearActiveChord = useCallback(() => keyBindingsManager.clearActiveChord(), []);

  return {
    bindings,
    registerAction: register,
    getKeyCombo,
    updateBindings,
    activeChord,
    clearActiveChord,
  };
}

export function useKeyBinding(
  actionId: string,
  callback: () => void,
  deps: React.DependencyList = []
) {
  const { registerAction: register } = useKeyBindings();

  // biome-ignore lint/correctness/useExhaustiveDependencies: callers provide dependencies for callback re-registration
  useEffect(() => register(actionId, callback), [actionId, register, ...deps]);
}
