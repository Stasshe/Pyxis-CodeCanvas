import type React from 'react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { snapshot, useSnapshot } from 'valtio';
import { subscribeKey } from 'valtio/utils';

import type { EditorPane, Tab } from '@/engine/tabs/types';
import { projectState } from '@/stores/projectStore';
import { tabActions, tabState } from '@/stores/tabState';

/**
 * TabSessionManager
 * - セッションの初期化 / 自動保存
 *
 * 以前の `TabProvider` にあった副作用をここに移植しました。
 * これにより、コンテキストの公開（useTabContext）は廃止され、
 * タブ状態は `useSnapshot(tabState)` と `tabActions` を直接使用してください。
 */
interface Props {
  children?: ReactNode;
}

export const TabSessionManager: React.FC<Props> = ({ children }) => {
  const { loadSession, saveSession } = tabActions;
  const { isLoading, activePane, globalActiveTab } = useSnapshot(tabState);
  const { currentRootPath } = useSnapshot(projectState);
  const initialRootPath = useRef(currentRootPath);
  // IndexedDBからセッションを復元
  useEffect(() => {
    loadSession(initialRootPath.current).catch(error => {
      console.error('[TabSessionManager] Failed to restore tab session:', error);
    });
  }, []);

  // Track a structural key derived from panes without re-rendering on frequent content updates
  const computeStructuralKey = (panes: readonly EditorPane[]) => {
    type StrippedPane = {
      id: string;
      size?: number;
      layout?: string;
      activeTabId: string;
      tabs: Array<{ id: string; kind: string; path?: string; name?: string }>;
      children?: StrippedPane[];
    };

    const strip = (pList: readonly EditorPane[]): StrippedPane[] =>
      pList.map(p => ({
        id: p.id,
        size: p.size,
        layout: p.layout,
        activeTabId: p.activeTabId,
        tabs:
          p.tabs?.map((t: Tab) => ({ id: t.id, kind: t.kind, path: t.path, name: t.name })) || [],
        children: p.children ? strip(p.children) : undefined,
      }));

    try {
      return JSON.stringify(strip(panes));
    } catch (e) {
      console.warn('[TabSessionManager.tsx] caught non-fatal error', e);
      try {
        return JSON.stringify(panes);
      } catch (_) {
        return String(panes);
      }
    }
  };

  const [structuralKey, setStructuralKey] = useState(() =>
    computeStructuralKey(snapshot(tabState).panes)
  );
  const structuralKeyRef = useRef(structuralKey);

  // biome-ignore lint/correctness/useExhaustiveDependencies: computeStructuralKey is a plain function with no state captures; run-once subscription
  useEffect(() => {
    // Subscribe to panes updates but only update local state when the structural key actually changes
    const unsub = subscribeKey(tabState, 'panes', () => {
      const newKey = computeStructuralKey(snapshot(tabState).panes);
      if (newKey !== structuralKeyRef.current) {
        structuralKeyRef.current = newKey;
        setStructuralKey(newKey);
      }
    });
    return unsub;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: structuralKey/activePane/globalActiveTab/saveSession are all needed trigger deps for session persistence
  useEffect(() => {
    if (isLoading) return; // 初期ロード中は保存しない
    if (!currentRootPath) return;
    const rootPath = currentRootPath;

    const timer = setTimeout(() => {
      saveSession(rootPath).catch(console.error);
    }, 1000);

    return () => clearTimeout(timer);
  }, [structuralKey, activePane, globalActiveTab, isLoading, currentRootPath, saveSession]);

  return <>{children}</>;
};

export default TabSessionManager;
