import { proxy } from 'valtio';

import type { EditorPane } from '@/engine/ide/tabs/types';

export const tabState = proxy({
  panes: [] as EditorPane[],
  activePane: null as string | null,
  globalActiveTab: null as string | null,
  isLoading: true,
  isRestored: false,
  isContentRestored: false,
  sessionError: null as string | null,
  sessionGeneration: 0,
  sessionRootPath: null as string | null,
});
