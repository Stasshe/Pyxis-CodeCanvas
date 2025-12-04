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

    // Helper to safely get className as string (handles SVG elements where className is SVGAnimatedString)
    const getClassName = (el: Element): string => {
      if (typeof el.className === 'string') {
        return el.className;
      }
      // For SVG elements, className is SVGAnimatedString with baseVal property
      return (el.className as unknown as { baseVal?: string })?.baseVal || '';
    };

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
      // If another handler already called preventDefault, don't interfere.
      if (e.defaultPrevented) return;
      const target = e.target as Element | null;

      // Allow scrolling when event originates from Monaco/editor internals
      // or from known minimap/scrollable editor containers. This is a best-effort
      // approach: look for classnames/attributes used by Monaco and similar editors.
      const isFromEditor = (el: Element | null) => {
        let cur = el;
        while (cur && cur !== document.documentElement) {
          const cls = getClassName(cur);
          const id = (cur.id || '') as string;
          const role = cur.getAttribute && cur.getAttribute('role');
          if (
            cls.includes('monaco') ||
            cls.includes('minimap') ||
            cls.includes('editor') ||
            id.includes('monaco') ||
            id.includes('minimap') ||
            role === 'editor' ||
            role === 'presentation'
          ) {
            return true;
          }
          cur = cur.parentElement;
        }
        return false;
      };

      if (isFromEditor(target)) return; // allow editor to handle its own scrolls

      if (!isScrollable(target) && !isSelectable(target)) {
        e.preventDefault();
      }
    };

    // Best-effort detection for editor-originated keyboard events
    const isFromEditor = (el: Element | null) => {
      let cur = el;
      while (cur && cur !== document.documentElement) {
        const cls = getClassName(cur);
        const id = (cur.id || '') as string;
        const role = cur.getAttribute && cur.getAttribute('role');
        if (
          cls.includes('monaco') ||
          cls.includes('minimap') ||
          cls.includes('editor') ||
          id.includes('monaco') ||
          id.includes('minimap') ||
          role === 'editor' ||
          role === 'presentation'
        ) {
          return true;
        }
        cur = cur.parentElement;
      }
      return false;
    };

    let touchStartY = 0;
    const touchStart = (e: TouchEvent) => {
      touchStartY = e.touches?.[0]?.clientY || 0;
    };
    const touchMove = (e: TouchEvent) => {
      if (e.defaultPrevented) return;
      const target = e.target as Element | null;

      // allow editors/minimap to handle touch scrolls
      let cur = target;
      while (cur && cur !== document.documentElement) {
        const cls = getClassName(cur);
        const id = (cur.id || '') as string;
        if (cls.includes('monaco') || cls.includes('minimap') || id.includes('monaco')) {
          return;
        }
        cur = cur.parentElement;
      }

      if (!isScrollable(target) && !isSelectable(target)) {
        e.preventDefault();
      }
    };

    const keyHandler = (e: KeyboardEvent) => {
      const keysToBlock = ['PageDown', 'PageUp', 'ArrowDown', 'ArrowUp', ' ', 'Home', 'End'];
      if (!keysToBlock.includes(e.key)) return;
      const active = document.activeElement as Element | null;
      // If the event target or active element appears to be part of Monaco (or
      // other in-app editors), allow it to handle the key event. This prevents
      // blocking space/arrow keys inside editors in browsers that don't make the
      // internal textarea the activeElement consistently (Chrome vs Safari).
      const target = e.target as Element | null;
      if (isFromEditor(target) || isFromEditor(active)) return;

      if (active) {
        const tag = (active.tagName || '').toLowerCase();
        const isEditable =
          tag === 'input' || tag === 'textarea' || (active as HTMLElement).isContentEditable;
        if (isEditable) return;
        if (isScrollable(active)) return;
      }
      e.preventDefault();
    };

    // Use bubble phase so inner components (like Monaco) get first chance to handle events.
    window.addEventListener('wheel', wheelHandler, { passive: false, capture: false });
    window.addEventListener('touchstart', touchStart, { passive: true, capture: false });
    window.addEventListener('touchmove', touchMove, { passive: false, capture: false });
    window.addEventListener('keydown', keyHandler, { passive: false, capture: false });

    return () => {
      window.removeEventListener('wheel', wheelHandler as any);
      window.removeEventListener('touchstart', touchStart as any);
      window.removeEventListener('touchmove', touchMove as any);
      window.removeEventListener('keydown', keyHandler as any);
    };
  }, []);
}

export default useGlobalScrollLock;
