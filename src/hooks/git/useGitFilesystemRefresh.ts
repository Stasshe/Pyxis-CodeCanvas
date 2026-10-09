import { useEffect } from 'react';
import { type FsChangeEvent, fsClient, isPathWithin } from '@/engine/core/fs/index';
import { triggerGitRefresh } from '@/stores/gitRefreshStore';

const DEBOUNCE_MS = 100;

function affectsGitRoot(event: FsChangeEvent, rootPath: string): boolean {
  if (isPathWithin(event.path, rootPath)) return true;
  if (!event.oldPath) return false;
  return isPathWithin(event.oldPath, rootPath);
}

export function useGitFilesystemRefresh(rootPath: string | null): void {
  useEffect(() => {
    if (!rootPath) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = fsClient.addChangeListener(event => {
      if (!affectsGitRoot(event, rootPath)) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(triggerGitRefresh, DEBOUNCE_MS);
    });

    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [rootPath]);
}
