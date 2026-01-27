"use client";
import { scan } from "react-scan";
import { useEffect, type ReactElement } from "react";
// why-did-you-render is dynamically imported below in dev/when explicitly enabled

export function ReactScan(): ReactElement | null {
  useEffect(() => {
    const enabled = process.env.NODE_ENV === 'development' || process.env.NEXT_PUBLIC_ENABLE_REACT_SCAN === 'true';
    if (!enabled) return; // 本番では無効（明示的なフラグがない限り）

    try {
      scan({ enabled: true });
    } catch (err) {
      console.error('react-scan init failed', err);
    }

    (async () => {
      try {
        // dynamic import to avoid bundling into production
        const ReactModule = await import('react');
        const React = ReactModule?.default ?? ReactModule;
        if (!React || typeof (React as any).createElement !== 'function') {
          console.warn('wdyr: invalid React object; skipping');
          return;
        }

        // @ts-ignore - optional dev dependency, may not have types
        const wdyrModule = await import('@welldone-software/why-did-you-render').catch(() => null);
        const init = wdyrModule?.default ?? wdyrModule;
        if (typeof init === 'function') {
          init(React, {
            trackAllPureComponents: true,
            trackHooks: true,
            collapseGroups: true,
          });
          console.info('why-did-you-render initialized (dev)');
        }
      } catch (err) {
        console.error('wdyr init failed', err);
      }
    })();

  }, []);

  return null;
}
