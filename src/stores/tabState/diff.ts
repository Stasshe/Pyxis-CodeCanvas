import type { DiffTab } from '@/engine/tabs/types';
import { isTabDirty, setTabContent } from '@/stores/tabContentStore';

export function refreshDiffTab(existing: DiffTab, fresh: DiffTab): DiffTab | null {
  if (existing.isDirty || isTabDirty(existing.id)) return null;

  if (fresh.editable && fresh.diffs.length === 1) {
    setTabContent(existing.id, fresh.diffs[0].latterContent, false);
  }
  return {
    ...existing,
    name: fresh.name,
    path: fresh.path,
    diffs: fresh.diffs,
    editable: fresh.editable,
    isDirty: false,
  };
}
