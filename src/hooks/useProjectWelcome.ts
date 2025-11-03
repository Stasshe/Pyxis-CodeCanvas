// src/hooks/useProjectWelcome.ts
import { useEffect } from 'react';

import { useTabContext } from '@/context/TabContext';
import { Project } from '@/types';

/**
 * プロジェクト読み込み時にWelcomeタブを開くカスタムフック
 */
export function useProjectWelcome(currentProject: Project | null) {
  const { panes, openTab } = useTabContext();

  useEffect(() => {
    if (!currentProject) {
      return;
    }

    // ペインが存在し、タブが1つもない場合のみWelcomeタブを開く
    if (panes.length > 0) {
      const firstPane = panes[0];
      if (firstPane.tabs.length === 0) {
        openTab(
          {
            name: currentProject.name,
            description: currentProject.description,
          },
          { kind: 'welcome' }
        );
      }
    }
  }, [currentProject?.id]);
}
