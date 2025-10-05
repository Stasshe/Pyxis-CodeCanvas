import { useEffect } from 'react';

/**
 * Global scroll lock + selection-friendly handlers.
 * Keeps the original behavior of preventing page-level scrolling while allowing
 * scrolling/selecting inside editable/selectable areas (inputs, contentEditable,
 * elements with user-select enabled, or native scrollable containers).
 */
export function useGlobalScrollLock() {
  // Force-disable page-level scroll via inline styles on html/body
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const html = document.documentElement as HTMLElement;
    const body = document.body as HTMLElement;

    const prev = {
      htmlOverflow: html.style.overflow,
      bodyOverflow: body.style.overflow,
      htmlHeight: html.style.height,
      bodyHeight: body.style.height,
      htmlOverscroll: html.style.overscrollBehavior,
    };

    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    html.style.height = '100vh';
    body.style.height = '100vh';
    html.style.overscrollBehavior = 'none';

    return () => {
      html.style.overflow = prev.htmlOverflow || '';
      body.style.overflow = prev.bodyOverflow || '';
      html.style.height = prev.htmlHeight || '';
      body.style.height = prev.bodyHeight || '';
      html.style.overscrollBehavior = prev.htmlOverscroll || '';
    };
  }, []);

  // Prevent wheel/touch/key page-level scrolling but allow scrolling/selecting
  // inside editable/selectable areas.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const isScrollable = (el: Element | null) => {
      let elCur: Element | null = el;
      while (elCur && elCur !== document.documentElement) {
        try {
          const style = window.getComputedStyle(elCur as Element);
          const overflowY = style.overflowY;
          const isScroll =
            overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
          if (
            isScroll &&
            (elCur as HTMLElement).scrollHeight > (elCur as HTMLElement).clientHeight
          ) {
            return true;
          }
        } catch (e) {
          // ignore
        }
        elCur = elCur.parentElement;
      }
      return false;
    };

    const isSelectable = (el: Element | null) => {
      let elCur: Element | null = el;
      while (elCur && elCur !== document.documentElement) {
        try {
          const asEl = elCur as HTMLElement;
          const tag = (asEl.tagName || '').toLowerCase();
          if (tag === 'input' || tag === 'textarea' || tag === 'select') return true;
          if (asEl.isContentEditable) return true;
          const style = window.getComputedStyle(asEl);
          const userSelect = style.userSelect || (style as any).webkitUserSelect;
          if (userSelect && userSelect !== 'none') return true;
        } catch (e) {
          // ignore
        }
        elCur = elCur.parentElement;
      }
      return false;
    };

    const wheelHandler = (e: WheelEvent) => {
      const target = e.target as Element | null;
      if (!isScrollable(target) && !isSelectable(target)) {
        e.preventDefault();
      }
    };

    let touchStartY = 0;
    const touchStart = (e: TouchEvent) => {
      touchStartY = e.touches?.[0]?.clientY || 0;
    };
    const touchMove = (e: TouchEvent) => {
      const target = e.target as Element | null;
      if (!isScrollable(target) && !isSelectable(target)) {
        e.preventDefault();
      }
    };

    const keyHandler = (e: KeyboardEvent) => {
      const keysToBlock = ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' ', 'Home', 'End'];
      if (!keysToBlock.includes(e.key)) return;
      const active = document.activeElement as Element | null;
      if (active) {
        const tag = (active.tagName || '').toLowerCase();
        const isEditable =
          tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable;
        if (isEditable) return;
        if (isScrollable(active)) return;
      }
      e.preventDefault();
    };

    window.addEventListener('wheel', wheelHandler, { passive: false, capture: true });
    window.addEventListener('touchstart', touchStart, { passive: true, capture: true });
    window.addEventListener('touchmove', touchMove, { passive: false, capture: true });
    window.addEventListener('keydown', keyHandler, { passive: false, capture: true });

    return () => {
      window.removeEventListener('wheel', wheelHandler, { capture: true } as any);
      window.removeEventListener('touchstart', touchStart as any, { capture: true } as any);
      window.removeEventListener('touchmove', touchMove as any, { capture: true } as any);
      window.removeEventListener('keydown', keyHandler as any, { capture: true } as any);
    };
  }, []);
}

export default useGlobalScrollLock;
