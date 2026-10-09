import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  formatKeyComboForDisplay,
  formatKeyEvent,
  normalizeKeyCombo,
} from '@/hooks/keybindings/keybindingUtils';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('key combo normalization', () => {
  it('uses Command for every Ctrl modifier in a Mac chord', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });

    expect(normalizeKeyCombo('Ctrl+K Ctrl+O')).toBe('Cmd+K Cmd+O');
    expect(formatKeyComboForDisplay('Ctrl+K Ctrl+O')).toBe('Cmd+K Cmd+O');
  });

  it('preserves Ctrl modifiers on non-Mac platforms', () => {
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });

    expect(normalizeKeyCombo('Ctrl+K Ctrl+O')).toBe('Ctrl+K Ctrl+O');
  });
});

describe('key event formatting', () => {
  const createKeyEvent = (overrides: Partial<KeyboardEvent> = {}): KeyboardEvent =>
    ({
      key: 'Enter',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      isComposing: false,
      keyCode: 13,
      ...overrides,
    }) as KeyboardEvent;

  it('ignores shortcut-like keys while IME composition is active', () => {
    expect(formatKeyEvent(createKeyEvent({ isComposing: true }))).toBe('');
  });

  it('ignores keyCode 229 even when isComposing is false', () => {
    expect(formatKeyEvent(createKeyEvent({ keyCode: 229 }))).toBe('');
  });

  it('formats the same shortcut after composition ends', () => {
    expect(formatKeyEvent(createKeyEvent())).toBe('Ctrl+Enter');
  });
});
