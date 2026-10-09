import { describe, expect, it } from 'vitest';
import { findTabElement } from '@/components/Tab/tabBarUtils';

describe('findTabElement', () => {
  it('matches JSON-based tab ids without treating their contents as a selector', () => {
    const tabId = 'ai:["/home/pyxis/ui3-practical/clone-hello","review.txt","msg-1"]';
    const otherTab = { dataset: { tabId: 'editor:review.txt' } };
    const reviewTab = { dataset: { tabId } };

    expect(findTabElement([otherTab, reviewTab], tabId)).toBe(reviewTab);
    expect(findTabElement([otherTab], tabId)).toBeUndefined();
  });
});
