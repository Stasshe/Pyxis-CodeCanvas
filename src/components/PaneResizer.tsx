// src/components/PaneResizer.tsx
'use client'

import type React from 'react'
import { useCallback, useRef, useState } from 'react'

import { useTheme } from '@/context/ThemeContext'
import { usePaneResize } from '@/hooks/usePaneResize'

interface PaneResizerProps {
  direction: 'horizontal' | 'vertical'
  onResize: (leftSize: number, rightSize: number) => void
  leftSize: number
  rightSize: number
  minSize?: number
}

/**
 * ペイン間リサイザーコンポーネント
 * usePaneResizeフックを使用してマウス/タッチイベントを処理
 */
export default function PaneResizer({
  direction,
  onResize,
  leftSize,
  rightSize,
  minSize = 10,
}: PaneResizerProps) {
  const { colors } = useTheme()
  const [isDragging, setIsDragging] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const { startResize } = usePaneResize({
    direction,
    leftSize,
    minSize,
    onResize,
    containerRef,
  })

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      startResize(e, setIsDragging)
    },
    [startResize]
  )

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      startResize(e, setIsDragging)
    },
    [startResize]
  )

  const resizerStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: isDragging ? colors.primary : colors.border,
    transition: isDragging ? 'none' : 'background-color 0.2s ease',
    cursor: direction === 'vertical' ? 'col-resize' : 'row-resize',
    zIndex: 20,
    ...(direction === 'vertical'
      ? {
          top: 0,
          bottom: 0,
          left: '50%',
          width: '2px',
          transform: 'translateX(-1px)',
        }
      : {
          left: 0,
          right: 0,
          top: '50%',
          height: '2px',
          transform: 'translateY(-1px)',
        }),
  }

  const hoverZoneStyle: React.CSSProperties = {
    position: 'absolute',
    backgroundColor: 'transparent',
    zIndex: 15,
    ...(direction === 'vertical'
      ? {
          top: 0,
          bottom: 0,
          left: 0,
          right: 0,
          cursor: 'col-resize',
        }
      : {
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          cursor: 'row-resize',
        }),
  }

  return (
    <div ref={containerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* ホバー検出用の広いエリア */}
      <div
        style={hoverZoneStyle}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onMouseEnter={() => {
          if (!isDragging) {
            document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize'
          }
        }}
        onMouseLeave={() => {
          if (!isDragging) {
            document.body.style.cursor = ''
          }
        }}
      />
      {/* 実際のリサイザーライン */}
      <div style={resizerStyle} onMouseDown={handleMouseDown} onTouchStart={handleTouchStart} />
    </div>
  )
}
