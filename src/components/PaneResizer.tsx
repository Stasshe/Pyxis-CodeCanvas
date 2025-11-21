// src/components/PaneResizer.tsx
'use client';

import React, { useState, useRef, useCallback } from 'react';

import { useTheme } from '@/context/ThemeContext';

interface PaneResizerProps {
  direction: 'horizontal' | 'vertical';
  onResize: (leftSize: number, rightSize: number) => void;
  leftSize: number;
  rightSize: number;
  minSize?: number;
}

export default function PaneResizer({
  direction,
  onResize,
  leftSize,
  rightSize,
  minSize = 10,
}: PaneResizerProps) {
  const { colors } = useTheme();
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const startResize = useCallback(
    (clientX: number, clientY: number) => {
      // 親コンテナを見つける
      let parentContainer = containerRef.current?.parentElement;
      while (parentContainer && !parentContainer.classList.contains('flex')) {
        parentContainer = parentContainer.parentElement;
      }

      if (!parentContainer) return;

      const containerRect = parentContainer.getBoundingClientRect();
      const containerStart = direction === 'vertical' ? containerRect.left : containerRect.top;
      const containerSize = direction === 'vertical' ? containerRect.width : containerRect.height;

      // 初期の分割点の位置（ピクセル）
      const initialSplitPos = (leftSize / 100) * containerSize;

      const handleMove = (moveX: number, moveY: number) => {
        const currentPos = direction === 'vertical' ? moveX : moveY;
        const relativePos = currentPos - containerStart;

        // 新しい分割点の位置を計算
        const newSplitPos = Math.max(
          (minSize * containerSize) / 100,
          Math.min(relativePos, containerSize - (minSize * containerSize) / 100)
        );

        // パーセントに変換
        const newLeftPercent = (newSplitPos / containerSize) * 100;
        const newRightPercent = 100 - newLeftPercent;

        // 最小サイズチェック
        if (newLeftPercent >= minSize && newRightPercent >= minSize) {
          onResize(newLeftPercent, newRightPercent);
        }
      };

      const handleStop = () => {
        setIsDragging(false);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.removeEventListener('touchmove', handleTouchMove);
        document.removeEventListener('touchend', handleTouchEnd);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };

      const handleMouseMove = (e: MouseEvent) => {
        e.preventDefault();
        handleMove(e.clientX, e.clientY);
      };

      const handleTouchMove = (e: TouchEvent) => {
        e.preventDefault();
        const touch = e.touches[0];
        handleMove(touch.clientX, touch.clientY);
      };

      const handleMouseUp = () => {
        handleStop();
      };

      const handleTouchEnd = () => {
        handleStop();
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleTouchEnd);
      document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
    },
    [direction, onResize, leftSize, minSize]
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      startResize(e.clientX, e.clientY);
    },
    [startResize]
  );

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(true);
      const touch = e.touches[0];
      startResize(touch.clientX, touch.clientY);
    },
    [startResize]
  );

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
  };

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
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', width: '100%', height: '100%' }}
    >
      {/* ホバー検出用の広いエリア */}
      <div
        style={hoverZoneStyle}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
        onMouseEnter={() => {
          if (!isDragging) {
            document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
          }
        }}
        onMouseLeave={() => {
          if (!isDragging) {
            document.body.style.cursor = '';
          }
        }}
      />
      {/* 実際のリサイザーライン */}
      <div
        style={resizerStyle}
        onMouseDown={handleMouseDown}
        onTouchStart={handleTouchStart}
      />
    </div>
  );
}
