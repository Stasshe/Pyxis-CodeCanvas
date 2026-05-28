// src/hooks/useProjectWelcome.ts
import { useEffect, useRef } from 'react';
import { snapshot } from 'valtio';
import { tabActions, tabState } from '@/stores/tabState';
import { flattenLeafPanes } from '@/stores/tabState/paneUtils';
import type { Project } from '@/types';

/**
 * プロジェクト読み込み時にWelcomeタブを開くカスタムフック
 */
export function useProjectWelcome(currentProject: Project | null) {
  const { openTab } = tabActions;
  const openingRef = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: currentProject?.id is the correct trigger; adding .name/.description would re-open welcome tab on rename
  useEffect(() => {
    if (!currentProject || openingRef.current) return;

    const state = snapshot(tabState);
    // コンテナ pane は children を持つため tabs が空。leaf pane で判定する
    const leaves = flattenLeafPanes([...state.panes]);
    if (leaves.length === 0) return;
    if (leaves.length > 1) return;
    const hasAnyTabs = leaves.some(p => p.tabs && p.tabs.length > 0);
    if (hasAnyTabs) return;

    openingRef.current = true;
    openTab(
      { name: currentProject.name, description: currentProject.description },
      { kind: 'welcome', paneId: leaves[0].id }
    ).finally(() => {
      openingRef.current = false;
    });
  }, [currentProject?.id]);
}
