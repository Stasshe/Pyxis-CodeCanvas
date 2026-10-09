interface TabElement {
  dataset: { tabId?: string };
}

export function findTabElement<T extends TabElement>(
  elements: Iterable<T>,
  tabId: string
): T | undefined {
  for (const element of elements) {
    if (element.dataset.tabId === tabId) return element;
  }
}
