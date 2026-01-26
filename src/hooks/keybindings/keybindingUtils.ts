/**
 * Keybinding helper utilities extracted from useKeyBindings for reuse and clarity.
 */
export type Binding = {
  id: string;
  name: string;
  combo: string;
  category?: string;
};

export function formatKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  if (isMac) {
    if (e.metaKey) parts.push('Cmd');
    if (e.ctrlKey) parts.push('Ctrl');
  } else {
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
  }

  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;

  // If IME is composing or the key is an ambiguous/processing value,
  // treat it as no-recognized-key so callers can handle IME safely.
  // `isComposing` is true when IME composition is active (Japanese input, etc.).
  if ((e as any).isComposing || key === 'Process' || key === 'Unidentified') return '';

  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return '';

  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);

  return parts.join('+');
}

export function normalizeKeyCombo(combo: string): string {
  const isMac =
    typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
  if (isMac) {
    return combo.replace(/^Ctrl\+/, 'Cmd+').replace(/\+Ctrl\+/, '+Cmd+');
  }
  return combo;
}

export function formatKeyComboForDisplay(combo: string): string {
  return normalizeKeyCombo(combo);
}
