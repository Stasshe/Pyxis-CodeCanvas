import { useCallback } from 'react';

export const useLeftSidebarResize = (
  leftSidebarWidth: number,
  setLeftSidebarWidth: (width: number) => void
) => {
  return useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    const isTouch = 'touches' in e;
    const startX = isTouch ? e.touches[0].clientX : e.clientX;
    const initialWidth = leftSidebarWidth;
    
    // 最小幅と最大幅の設定
    const minWidth = 120;
    const maxWidth = window.innerWidth * 0.7;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      
      const currentX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const deltaX = currentX - startX;
      
      const newWidth = initialWidth + deltaX;
      const clampedWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
      
      setLeftSidebarWidth(clampedWidth);
      
      // 強制的にレイアウト更新を促す
      const sidebar = document.querySelector('[data-sidebar="left"]') as HTMLElement;
      if (sidebar) {
        sidebar.style.width = `${clampedWidth}px`;
        sidebar.offsetHeight;
      }
    };

    const handleEnd = () => {
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
  }, [leftSidebarWidth, setLeftSidebarWidth]);
};

export const useBottomPanelResize = (
  bottomPanelHeight: number,
  setBottomPanelHeight: (height: number) => void
) => {
  return useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    e.preventDefault();
    
    const isTouch = 'touches' in e;
    const startY = isTouch ? e.touches[0].clientY : e.clientY;
    const initialHeight = bottomPanelHeight;
    
    // 最小高さと最大高さの設定
    const minHeight = 100;
    const maxHeight = window.innerHeight * 0.6;

    const handleMove = (e: MouseEvent | TouchEvent) => {
      e.preventDefault();
      
      const currentY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const deltaY = startY - currentY;
      
      const newHeight = initialHeight + deltaY;
      const clampedHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
      
      setBottomPanelHeight(clampedHeight);
    };

    const handleEnd = () => {
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
  }, [bottomPanelHeight, setBottomPanelHeight]);
};
