// src/hooks/useProjectWelcome.ts
import { useEffect } from 'react';

import { tabActions, tabState } from '@/stores/tabState';
import { useSnapshot } from 'valtio';
import type { Project } from '@/types';

/**
 * プロジェクト読み込み時にWelcomeタブを開くカスタムフック
 */
export function useProjectWelcome(currentProject: Project | null) {
<<<<<<< Updated upstream
  const openTab = useTabStore(state => state.openTab);
=======
  const { panes } = useSnapshot(tabState);
  const { openTab } = tabActions;
>>>>>>> Stashed changes

  useEffect(() => {
    if (!currentProject) {
      return;
    }

    const state = useTabStore.getState();

    // ペインが存在し、タブが1つもない場合のみWelcomeタブを開く
    if (state.panes.length > 0) {
      const firstPane = state.panes[0];
      if (firstPane.tabs.length === 0) {
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
