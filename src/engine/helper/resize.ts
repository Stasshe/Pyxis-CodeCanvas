// 右サイドバー用リサイズフック
export const useRightSidebarResize = (
  rightSidebarWidth: number,
  setRightSidebarWidth: (width: number) => void
) => {
  return (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const isTouch = 'touches' in e;
    const startX = isTouch ? e.touches[0].clientX : e.clientX;
    const initialWidth = rightSidebarWidth;
    const minWidth = 120;
    const maxWidth = window.innerWidth * 0.7;

    let rafId: number | null = null;
    const widthRef = { current: initialWidth };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const deltaX = startX - currentX;
      const newWidth = initialWidth + deltaX;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      widthRef.current = clampedWidth;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        setRightSidebarWidth(widthRef.current);
        const sidebar = document.querySelector('[data-sidebar="right"]') as HTMLElement;
        if (sidebar) {
          sidebar.style.width = `${widthRef.current}px`;
        }
      });
    };

    const handleEnd = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.removeEventListener('mousemove', handleMove as EventListener);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove as EventListener);
      document.removeEventListener('touchend', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.touchAction = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';
    document.addEventListener('mousemove', handleMove as EventListener);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove as EventListener);
    document.addEventListener('touchend', handleEnd);
  };
};
import { useCallback } from 'react';

export const useLeftSidebarResize = (
  leftSidebarWidth: number,
  setLeftSidebarWidth: (width: number) => void
) => {
  return (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const isTouch = 'touches' in e;
    const startX = isTouch ? e.touches[0].clientX : e.clientX;
    const initialWidth = leftSidebarWidth;
    const minWidth = 120;
    const maxWidth = window.innerWidth * 0.7;

    let rafId: number | null = null;
    const widthRef = { current: initialWidth };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const deltaX = currentX - startX;
      const newWidth = initialWidth + deltaX;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      widthRef.current = clampedWidth;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        setLeftSidebarWidth(widthRef.current);
        const sidebar = document.querySelector('[data-sidebar="left"]') as HTMLElement;
        if (sidebar) {
          sidebar.style.width = `${widthRef.current}px`;
        }
      });
    };

    const handleEnd = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.removeEventListener('mousemove', handleMove as EventListener);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove as EventListener);
      document.removeEventListener('touchend', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.touchAction = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';
    document.addEventListener('mousemove', handleMove as EventListener);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove as EventListener);
    document.addEventListener('touchend', handleEnd);
  };
};

export const useBottomPanelResize = (
  bottomPanelHeight: number,
  setBottomPanelHeight: (height: number) => void
) => {
  return (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    const isTouch = 'touches' in e;
    const startY = isTouch ? e.touches[0].clientY : e.clientY;
    const initialHeight = bottomPanelHeight;
    const minHeight = 100;
    const maxHeight = window.innerHeight;

    let rafId: number | null = null;
    const heightRef = { current: initialHeight };

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const deltaY = startY - currentY;
      const newHeight = initialHeight + deltaY;
      const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      heightRef.current = clampedHeight;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      rafId = requestAnimationFrame(() => {
        setBottomPanelHeight(heightRef.current);
        const panel = document.querySelector('[data-panel="bottom"]') as HTMLElement;
        if (panel) {
          panel.style.height = `${heightRef.current}px`;
        }
      });
    };

    const handleEnd = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      document.removeEventListener('mousemove', handleMove as EventListener);
      document.removeEventListener('mouseup', handleEnd);
      document.removeEventListener('touchmove', handleMove as EventListener);
      document.removeEventListener('touchend', handleEnd);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.body.style.touchAction = '';
    };

    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
    document.body.style.touchAction = 'none';
    document.addEventListener('mousemove', handleMove as EventListener);
    document.addEventListener('mouseup', handleEnd);
    document.addEventListener('touchmove', handleMove as EventListener);
    document.addEventListener('touchend', handleEnd);
  };
};
