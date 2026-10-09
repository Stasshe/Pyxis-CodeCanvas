import { tabRegistry } from '@/engine/ide/tabs/TabRegistry';
import type { Tab } from '@/engine/ide/tabs/types';

export function notifyTabClosed(tab: Tab): void {
  const onClose = tabRegistry.get(tab.kind)?.onClose;
  if (!onClose) return;
  try {
    void Promise.resolve(onClose(tab)).catch(error => {
      console.error(`[TabStore] Close callback failed for tab ${tab.id}:`, error);
    });
  } catch (error) {
    console.error(`[TabStore] Close callback failed for tab ${tab.id}:`, error);
  }
}
