const TOUCH_SCROLL_START_THRESHOLD = 10;
const TOUCH_SCROLL_PIXELS_PER_LINE = 20;

export function createTerminalTouchScrollHandler(scrollLines: (amount: number) => void) {
  let startY = 0;
  let previousY = 0;
  let started = false;
  let remainingDelta = 0;

  return {
    start(clientY: number) {
      startY = clientY;
      previousY = clientY;
      started = false;
      remainingDelta = 0;
    },
    move(clientY: number) {
      if (!started) {
        const delta = startY - clientY;
        if (Math.abs(delta) <= TOUCH_SCROLL_START_THRESHOLD) return;
        started = true;
        remainingDelta = delta;
      } else {
        remainingDelta += previousY - clientY;
      }

      previousY = clientY;
      const amount = Math.trunc(remainingDelta / TOUCH_SCROLL_PIXELS_PER_LINE);
      if (amount === 0) return;
      remainingDelta -= amount * TOUCH_SCROLL_PIXELS_PER_LINE;
      scrollLines(amount);
    },
  };
}
