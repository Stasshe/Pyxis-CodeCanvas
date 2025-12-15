import { useCallback, useRef, useEffect } from 'react'

type Direction = 'horizontal' | 'vertical'

interface UsePaneResizeOptions {
  direction: Direction
  leftSize: number
  minSize?: number
  onResize: (leftPercent: number, rightPercent: number) => void
  containerRef: React.RefObject<HTMLDivElement | null>
}

interface ResizeState {
  isResizing: boolean
  containerStart: number
  containerSize: number
}

/**
 * ペイン間リサイズ用フック
 * パーセンテージベースで2つの隣接ペインのサイズを調整
 */
export function usePaneResize(options: UsePaneResizeOptions) {
  const { direction, leftSize, minSize = 10, onResize, containerRef } = options

  const stateRef = useRef<ResizeState>({
    isResizing: false,
    containerStart: 0,
    containerSize: 0,
  })

  // Store handlers in refs for cleanup
  const mouseMoveHandler = useRef<((e: MouseEvent) => void) | null>(null)
  const mouseUpHandler = useRef<(() => void) | null>(null)
  const touchMoveHandler = useRef<((e: TouchEvent) => void) | null>(null)
  const touchEndHandler = useRef<(() => void) | null>(null)

  const handleStop = useCallback((setIsDragging?: (v: boolean) => void) => {
    const state = stateRef.current
    if (!state.isResizing) return

    state.isResizing = false
    setIsDragging?.(false)

    // Remove listeners
    if (mouseMoveHandler.current) {
      document.removeEventListener('mousemove', mouseMoveHandler.current)
    }
    if (mouseUpHandler.current) {
      document.removeEventListener('mouseup', mouseUpHandler.current)
    }
    if (touchMoveHandler.current) {
      document.removeEventListener('touchmove', touchMoveHandler.current)
    }
    if (touchEndHandler.current) {
      document.removeEventListener('touchend', touchEndHandler.current)
    }

    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleStop()
    }
  }, [handleStop])

  const startResize = useCallback(
    (e: React.MouseEvent | React.TouchEvent, setIsDragging?: (v: boolean) => void) => {
      e.preventDefault()
      e.stopPropagation()

      // Find parent flex container (with max depth limit to prevent infinite loops)
      const MAX_DEPTH = 20
      let parentContainer = containerRef.current?.parentElement
      let depth = 0
      while (parentContainer && !parentContainer.classList.contains('flex') && depth < MAX_DEPTH) {
        parentContainer = parentContainer.parentElement
        depth++
      }
      if (!parentContainer || depth >= MAX_DEPTH) return

      const containerRect = parentContainer.getBoundingClientRect()
      const state = stateRef.current
      state.isResizing = true
      state.containerStart = direction === 'vertical' ? containerRect.left : containerRect.top
      state.containerSize = direction === 'vertical' ? containerRect.width : containerRect.height

      setIsDragging?.(true)

      const handleMove = (clientX: number, clientY: number) => {
        const currentPos = direction === 'vertical' ? clientX : clientY
        const relativePos = currentPos - state.containerStart

        // Calculate min boundary in pixels (extracted for readability)
        const minBoundaryPx = (minSize * state.containerSize) / 100

        // Calculate new split position
        const newSplitPos = Math.max(
          minBoundaryPx,
          Math.min(relativePos, state.containerSize - minBoundaryPx)
        )

        // Convert to percentage
        const newLeftPercent = (newSplitPos / state.containerSize) * 100
        const newRightPercent = 100 - newLeftPercent

        // Apply if within bounds
        if (newLeftPercent >= minSize && newRightPercent >= minSize) {
          onResize(newLeftPercent, newRightPercent)
        }
      }

      // Create handlers
      mouseMoveHandler.current = (e: MouseEvent) => {
        e.preventDefault()
        handleMove(e.clientX, e.clientY)
      }

      mouseUpHandler.current = () => handleStop(setIsDragging)

      touchMoveHandler.current = (e: TouchEvent) => {
        e.preventDefault()
        const touch = e.touches[0]
        handleMove(touch.clientX, touch.clientY)
      }

      touchEndHandler.current = () => handleStop(setIsDragging)

      // Add listeners
      document.addEventListener('mousemove', mouseMoveHandler.current)
      document.addEventListener('mouseup', mouseUpHandler.current)
      document.addEventListener('touchmove', touchMoveHandler.current, { passive: false })
      document.addEventListener('touchend', touchEndHandler.current)
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize'
      document.body.style.userSelect = 'none'
    },
    [direction, minSize, onResize, containerRef, handleStop]
  )

  return { startResize }
}

export default usePaneResize
