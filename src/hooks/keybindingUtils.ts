/**
 * Keybinding helper utilities extracted from useKeyBindings for reuse and clarity.
 */
export type Binding = {
  id: string;
  name: string;
  combo: string;
  category?: string;
};

function isMacOrIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  
  // Check for Mac via platform (legacy)
  const platform = navigator.platform?.toUpperCase() || '';
  if (platform.includes('MAC') || platform.includes('IPHONE') || platform.includes('IPAD')) {
    return true;
  }
  
  // Check for iOS/iPadOS via userAgent (modern)
  const userAgent = navigator.userAgent || '';
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return true;
  }
  
  // Check for iPadOS (which reports as Mac in newer versions)
  if (platform.includes('MAC') && navigator.maxTouchPoints && navigator.maxTouchPoints > 1) {
    return true;
  }
  
  return false;
}

export function formatKeyEvent(e: KeyboardEvent): string {
  const parts: string[] = [];

  const isMacPlatform = isMacOrIOS();
  if (isMacPlatform) {
    if (e.metaKey) parts.push('Cmd');
    if (e.ctrlKey) parts.push('Ctrl');
  } else {
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.metaKey) parts.push('Meta');
  }

  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return '';

  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);

  return parts.join('+');
}

export function normalizeKeyCombo(combo: string): string {
  const isMacPlatform = isMacOrIOS();
  if (isMacPlatform) {
    return combo.replace(/^Ctrl\+/, 'Cmd+').replace(/\+Ctrl\+/, '+Cmd+');
  }
  return combo;
}

export function formatKeyComboForDisplay(combo: string): string {
  return normalizeKeyCombo(combo);
}
