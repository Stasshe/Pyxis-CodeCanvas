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
  /** If false, onResize will only be called on drag end. defaults to true */
  shouldUpdateStateDuringResize?: boolean;
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
    shouldUpdateStateDuringResize = true,
  } = options;

  const stateRef = useRef<ResizeState>({
    isResizing: false,
    startPos: 0,
    initialSize,
    rafId: null,
    currentSize: initialSize,
  });

  const cleanupDocumentState = useCallback(() => {
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    document.body.style.touchAction = '';
    document.body.classList.remove('ui-resizing');

    if (mouseMoveHandler.current) {
      document.removeEventListener('mousemove', mouseMoveHandler.current);
    }
    if (mouseUpHandler.current) {
      document.removeEventListener('mouseup', mouseUpHandler.current);
    }
    if (touchMoveHandler.current) {
      document.removeEventListener('touchmove', touchMoveHandler.current);
    }
    if (touchEndHandler.current) {
      document.removeEventListener('touchend', touchEndHandler.current);
    }

    mouseMoveHandler.current = null;
    mouseUpHandler.current = null;
    touchMoveHandler.current = null;
    touchEndHandler.current = null;
  }, []);

  // Create stable event handlers that will be registered/removed
  const mouseMoveHandler = useRef<((e: MouseEvent) => void) | null>(null);
  const mouseUpHandler = useRef<(() => void) | null>(null);
  const touchMoveHandler = useRef<((e: TouchEvent) => void) | null>(null);
  const touchEndHandler = useRef<(() => void) | null>(null);

  // Clean up any pending animation frame on unmount
  useEffect(() => {
    return () => {
      if (stateRef.current.rafId !== null) {
        cancelAnimationFrame(stateRef.current.rafId);
      }
      stateRef.current.isResizing = false;
      cleanupDocumentState();
    };
  }, [cleanupDocumentState]);

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
        if (shouldUpdateStateDuringResize) {
          onResize(state.currentSize);
        }

        // Direct DOM update for better performance during drag
        if (targetSelector) {
          const element = document.querySelector(targetSelector) as HTMLElement;
          if (element) {
            if (direction === 'horizontal') {
              const sizePx = `${state.currentSize}px`;
              element.style.height = sizePx;
              // React sets min/max height/width equal to size, so we must update them too
              // otherwise they will constrain the element to the old size
              if (element.style.minHeight) element.style.minHeight = sizePx;
              if (element.style.maxHeight) element.style.maxHeight = sizePx;
            } else {
              const sizePx = `${state.currentSize}px`;
              element.style.width = sizePx;
              if (element.style.minWidth) element.style.minWidth = sizePx;
              if (element.style.maxWidth) element.style.maxWidth = sizePx;
            }
          }
        }
      });
    },
    [direction, minSize, maxSize, onResize, targetSelector, shouldUpdateStateDuringResize]
  );

  const handleEnd = useCallback(() => {
    const state = stateRef.current;
    if (!state.isResizing) return;

    state.isResizing = false;

    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }

    // Commit final size if we skipped updates during resize
    if (!shouldUpdateStateDuringResize) {
      onResize(state.currentSize);
    }

    cleanupDocumentState();
  }, [cleanupDocumentState, onResize, shouldUpdateStateDuringResize]);

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
      document.body.classList.add('ui-resizing');

      // Create handlers with closure over isInverted
      mouseMoveHandler.current = (e: MouseEvent) => {
        e.preventDefault();
        handleMove(e.clientX, e.clientY, isInverted);
      };

      mouseUpHandler.current = () => {
        handleEnd();
      };

      touchMoveHandler.current = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY, isInverted);
      };

      touchEndHandler.current = () => {
        handleEnd();
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
