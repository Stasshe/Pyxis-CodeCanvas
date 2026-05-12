import { useSyncExternalStore } from 'react';

let gitRefreshVersion = 0;
const listeners = new Set<() => void>();

export function triggerGitRefresh() {
  gitRefreshVersion += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function useGitRefreshVersion() {
  return useSyncExternalStore(
    listener => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    () => gitRefreshVersion,
    () => gitRefreshVersion
  );
}
