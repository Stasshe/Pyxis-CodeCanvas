import { describe, expect, it, vi } from 'vitest';

import { createTerminalTouchScrollHandler } from '@/engine/system/terminal/terminalTouchScroll';

describe('terminal touch scrolling', () => {
  it('processes each move after the start threshold', () => {
    const scrollLines = vi.fn();
    const touch = createTerminalTouchScrollHandler(scrollLines);

    touch.start(100);
    touch.move(89);
    touch.move(69);
    touch.move(49);

    expect(scrollLines.mock.calls).toEqual([[1], [1]]);
  });

  it('keeps the same scroll distance across fine-grained moves', () => {
    const scrollLines = vi.fn();
    const touch = createTerminalTouchScrollHandler(scrollLines);

    touch.start(100);
    for (let y = 89; y >= 60; y -= 1) touch.move(y);

    expect(scrollLines.mock.calls).toEqual([[1], [1]]);
  });

  it('scrolls in the reverse direction when the gesture reverses', () => {
    const scrollLines = vi.fn();
    const touch = createTerminalTouchScrollHandler(scrollLines);

    touch.start(100);
    touch.move(80);
    touch.move(59);
    touch.move(80);

    expect(scrollLines.mock.calls).toEqual([[1], [1], [-1]]);
  });

  it('resets accumulated movement when a new gesture starts', () => {
    const scrollLines = vi.fn();
    const touch = createTerminalTouchScrollHandler(scrollLines);

    touch.start(100);
    touch.move(89);
    touch.start(100);
    touch.move(120);

    expect(scrollLines.mock.calls).toEqual([[-1]]);
  });
});
