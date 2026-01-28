'use client';
import { scan } from 'react-scan';
import { useEffect, type ReactElement } from 'react';

export function ReactScan(): ReactElement | null {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const isDev = process.env.NODE_ENV !== 'production';
    const forceEnable = process.env.NEXT_PUBLIC_ENABLE_REACT_SCAN === 'true';
    if (!isDev && !forceEnable) return; // 本番では無効（明示的なフラグがない限り）
    try {
      scan({ enabled: true });
    } catch (e) {
      console.error(e);
    }
  }, []);

  return null;
}
