import type { AIReviewTab } from '../tabs/types';

const discardedDraftTabs = new Set<string>();

export function markAIReviewDraftDiscarded(
  tab: AIReviewTab,
  identity: { rootPath: string; filePath: string; parentMessageId: string }
): boolean {
  if (
    tab.aiEntry?.rootPath !== identity.rootPath ||
    tab.filePath !== identity.filePath ||
    tab.aiEntry.parentMessageId !== identity.parentMessageId
  ) {
    return false;
  }
  discardedDraftTabs.add(tab.id);
  return true;
}

export function isAIReviewDraftDiscarded(tabId: string): boolean {
  return discardedDraftTabs.has(tabId);
}

export function clearAIReviewDraftDiscarded(tabId: string): void {
  discardedDraftTabs.delete(tabId);
}
