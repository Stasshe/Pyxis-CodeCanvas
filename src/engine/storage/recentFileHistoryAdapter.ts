import { STORES, storageService } from '@/engine/storage';

const HISTORY_LIMIT = 40;
const pendingWrites = new Map<string, Promise<void>>();

function historyKey(rootPath: string): string {
  return `quickOpenHistory:${rootPath}`;
}

export async function getRecentFilePaths(rootPath: string): Promise<string[]> {
  if (!rootPath) return [];
  const pending = pendingWrites.get(rootPath);
  if (pending) await pending.catch(() => undefined);
  return readRecentFilePaths(rootPath);
}

async function readRecentFilePaths(rootPath: string): Promise<string[]> {
  const paths = await storageService.get<string[]>(STORES.USER_PREFERENCES, historyKey(rootPath));
  if (!Array.isArray(paths)) return [];
  return paths
    .filter((filePath): filePath is string => typeof filePath === 'string')
    .slice(0, HISTORY_LIMIT);
}

export function recordRecentFilePath(rootPath: string, filePath: string): Promise<void> {
  if (!rootPath || !filePath) return Promise.resolve();
  const previous = pendingWrites.get(rootPath) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const paths = await readRecentFilePaths(rootPath);
      const updated = [filePath, ...paths.filter(path => path !== filePath)].slice(
        0,
        HISTORY_LIMIT
      );
      await storageService.set(STORES.USER_PREFERENCES, historyKey(rootPath), updated);
    });
  pendingWrites.set(rootPath, next);
  const cleanup = () => {
    if (pendingWrites.get(rootPath) === next) pendingWrites.delete(rootPath);
  };
  void next.then(cleanup, cleanup);
  return next;
}
