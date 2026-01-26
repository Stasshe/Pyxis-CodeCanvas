import { useCallback, useEffect, useRef } from 'react';

type Direction = 'horizontal' | 'vertical';

interface UseResizeOptions {
  direction: Direction;
  initialSize: number;
  minSize?: number;
  maxSize?: number;
  onResize: (newSize: number) => void;
  /** Optional: selector to directly update DOM element during drag for better performance */
  targetSelector?: string;
}

interface ResizeState {
  isResizing: boolean;
  startPos: number;
  initialSize: number;
  rafId: number | null;
  currentSize: number;
}

/** Calculate default max size based on direction and window dimensions */
function getDefaultMaxSize(direction: Direction): number {
  if (typeof window === 'undefined') return 1000;
  const dimension = direction === 'horizontal' ? window.innerHeight : window.innerWidth;
  return dimension * 0.7;
}

/**
 * 汎用リサイズフック - マウスとタッチの両方に対応
 *
 * 従来の個別リサイズフック（useLeftSidebarResize, useRightSidebarResize, useBottomPanelResize）を
 * 1つの汎用フックに統合し、コードの重複を排除
 */
export function useResize(options: UseResizeOptions) {
  const {
    direction,
    initialSize,
    minSize = 100,
    maxSize = getDefaultMaxSize(direction),
    onResize,
    targetSelector,
  } = options;

  const stateRef = useRef<ResizeState>({
    isResizing: false,
    startPos: 0,
    initialSize,
    rafId: null,
    currentSize: initialSize,
  });

  // Clean up any pending animation frame on unmount
  useEffect(() => {
    return () => {
      if (stateRef.current.rafId !== null) {
        cancelAnimationFrame(stateRef.current.rafId);
      }
    };
  }, []);

  const handleMove = useCallback(
    (clientX: number, clientY: number, isInverted = false) => {
      const state = stateRef.current;
      if (!state.isResizing) return;

      const currentPos = direction === 'horizontal' ? clientY : clientX;
      const delta = isInverted ? state.startPos - currentPos : currentPos - state.startPos;

      const newSize = state.initialSize + delta;
      const clampedSize = Math.max(minSize, Math.min(maxSize, newSize));

      state.currentSize = clampedSize;

      // Cancel previous frame and schedule new one
      if (state.rafId !== null) {
        cancelAnimationFrame(state.rafId);
      }

      state.rafId = requestAnimationFrame(() => {
        onResize(state.currentSize);

        // Direct DOM update for better performance during drag
        if (targetSelector) {
          const element = document.querySelector(targetSelector) as HTMLElement;
          if (element) {
            if (direction === 'horizontal') {
              element.style.height = `${state.currentSize}px`;
            } else {
              element.style.width = `${state.currentSize}px`;
            }
          }
        }
      });
    },
    [direction, minSize, maxSize, onResize, targetSelector]
  );

  const handleEnd = useCallback(() => {
    const state = stateRef.current;
    if (!state.isResizing) return;

    state.isResizing = false;

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    // Reset body styles
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.touchAction = '';
  }, []);

  // Create stable event handlers that will be registered/removed
  const mouseMoveHandler = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpHandler = useRef<(() => void) | null>(null);
  const touchMoveHandler = useRef<((e: TouchEvent) => void) | null>(null);
  const touchEndHandler = useRef<(() => void) | null>(null);

  const startResize = useCallback(
    (
      e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>,
      isInverted = false
    ) => {
      e.preventDefault();

      const isTouch = 'touches' in e;
      const startPos = isTouch
        ? direction === 'horizontal'
          ? e.touches[0].clientY
          : e.touches[0].clientX
        : direction === 'horizontal'
          ? e.clientY
          : e.clientX;

      const state = stateRef.current;
      state.isResizing = true;
      state.startPos = startPos;
      state.initialSize = initialSize;
      state.currentSize = initialSize;

      // Set body styles
      document.body.style.cursor = direction === 'horizontal' ? 'row-resize' : 'col-resize';
      document.body.style.userSelect = 'none';
      document.body.style.touchAction = 'none';

      // Create handlers with closure over isInverted
      mouseMoveHandler.current = (e: MouseEvent) => {
        e.preventDefault();
        handleMove(e.clientX, e.clientY, isInverted);
      };

      mouseUpHandler.current = () => {
        handleEnd();
        // Remove listeners
        document.removeEventListener('mousemove', mouseMoveHandler.current!);
        document.removeEventListener('mouseup', mouseUpHandler.current!);
      };

      touchMoveHandler.current = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY, isInverted);
      };

      touchEndHandler.current = () => {
        handleEnd();
        // Remove listeners
        document.removeEventListener('touchmove', touchMoveHandler.current!);
        document.removeEventListener('touchend', touchEndHandler.current!);
      };

      // Add event listeners
      document.addEventListener('mousemove', mouseMoveHandler.current);
      document.addEventListener('mouseup', mouseUpHandler.current);
      document.addEventListener('touchmove', touchMoveHandler.current, { passive: false });
      document.addEventListener('touchend', touchEndHandler.current);
    },
    [direction, initialSize, handleMove, handleEnd]
  );

  return {
    startResize,
    /** For right sidebar where drag direction is inverted */
    startResizeInverted: useCallback(
      (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) =>
        startResize(e, true),
      [startResize]
    ),
  };
}

export default useResize;
