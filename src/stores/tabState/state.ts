import { proxy } from 'valtio';

import type { EditorPane } from '@/engine/tabs/types';

export const tabState = proxy({
  panes: [] as EditorPane[],
  activePane: null as string | null,
  globalActiveTab: null as string | null,
  isLoading: true,
  isRestored: false,
  isContentRestored: false,
});
