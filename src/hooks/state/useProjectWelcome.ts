// src/hooks/useProjectWelcome.ts
import { useEffect } from 'react';

import { tabActions, tabState } from '@/stores/tabState';
import type { Project } from '@/types';
import { snapshot, useSnapshot } from 'valtio';

/**
 * プロジェクト読み込み時にWelcomeタブを開くカスタムフック
 */
export function useProjectWelcome(currentProject: Project | null) {
  const { openTab } = tabActions;

  useEffect(() => {
    if (!currentProject) {
      return;
    }

    const state = snapshot(tabState);

    // ペインが存在し、タブが1つもない場合のみWelcomeタブを開く
    if (state.panes.length > 0) {
      const firstPane = state.panes[0];
      if (!firstPane.tabs || firstPane.tabs.length === 0) {
        (async () => {
          await openTab(
            {
              name: currentProject.name,
              description: currentProject.description,
            },
            { kind: 'welcome' }
          );
        })();
      }
    }
  }, [currentProject?.id]);
}
