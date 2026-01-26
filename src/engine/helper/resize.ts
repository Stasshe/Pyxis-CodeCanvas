/**
 * リサイズフック - 汎用useResizeフックを使用したシンプルな実装
 *
 * 従来の実装では各サイドバー/パネル用に個別のフックがあり、
 * 同じパターン（mousedown/touchstart -> move -> end）が繰り返されていた。
 * 新しい実装では useResize フックを使用して、コードの重複を排除。
 */

import { useResize } from '@/hooks/ui/useResize';

// 右サイドバー用リサイズフック
export const useRightSidebarResize = (
  rightSidebarWidth: number,
  setRightSidebarWidth: (width: number) => void
) => {
  const { startResizeInverted } = useResize({
    direction: 'vertical',
    initialSize: rightSidebarWidth,
    minSize: 120,
    maxSize: typeof window !== 'undefined' ? window.innerWidth * 0.7 : 1000,
    onResize: setRightSidebarWidth,
    targetSelector: '[data-sidebar="right"]',
  });

  return startResizeInverted;
};

// 左サイドバー用リサイズフック
export const useLeftSidebarResize = (
  leftSidebarWidth: number,
  setLeftSidebarWidth: (width: number) => void
) => {
  const { startResize } = useResize({
    direction: 'vertical',
    initialSize: leftSidebarWidth,
    minSize: 120,
    maxSize: typeof window !== 'undefined' ? window.innerWidth * 0.7 : 1000,
    onResize: setLeftSidebarWidth,
    targetSelector: '[data-sidebar="left"]',
  });

  return startResize;
};

// ボトムパネル用リサイズフック
export const useBottomPanelResize = (
  bottomPanelHeight: number,
  setBottomPanelHeight: (height: number) => void
) => {
  const { startResizeInverted } = useResize({
    direction: 'horizontal',
    initialSize: bottomPanelHeight,
    minSize: 100,
    maxSize: typeof window !== 'undefined' ? window.innerHeight : 1000,
    onResize: setBottomPanelHeight,
    targetSelector: '[data-panel="bottom"]',
  });

  return startResizeInverted;
};
