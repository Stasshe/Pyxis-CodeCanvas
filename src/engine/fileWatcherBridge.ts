import { coreWarn, coreInfo } from '@/engine/core/coreLogger';
import { fileRepository } from '@/engine/core/fileRepository';
import { notifyFileChange } from '@/engine/fileWatcher';

/**
 * Advanced FileRepository -> window FILE_CHANGE_EVENT bridge.
 * - Caches projectId -> projectName
 * - Normalizes paths (ensures leading slash)
 * - Omits very large content from dispatched events (watcher should read from repo/fs)
 * - Debounces/coalesces rapid events per-path (default 150ms)
 * - Provides init/destroy APIs and returns unsubscribe for tests
 */

const DEFAULT_DEBOUNCE_MS = 150;
const MAX_INLINE_CONTENT_BYTES = 16 * 1024; // 16 KB inline cutoff

type PendingEvent = {
  lastEvent: any;
  timer?: number;
};

let initialized = false;
let unsubscribeRepo: (() => void) | null = null;
const projectNameCache: Map<string, string> = new Map();
const pending: Map<string, PendingEvent> = new Map();

function normalizePath(p: string) {
  if (!p) return '';
  return p.startsWith('/') ? p : '/' + p;
}

async function resolveProjectName(projectId: string) {
  if (!projectId) return '';
  const cached = projectNameCache.get(projectId);
  if (cached) return cached;
  try {
    const projects = await fileRepository.getProjects();
    const proj = projects.find(p => p.id === projectId);
    if (proj) {
      projectNameCache.set(projectId, proj.name);
      return proj.name;
    }
  } catch (e) {
    coreWarn('[fileWatcherBridge] Failed to resolve project name:', e);
  }
  return '';
}

function shouldInlineContent(content: any) {
  if (!content) return false;
  if (typeof content === 'string') {
    return new TextEncoder().encode(content).length <= MAX_INLINE_CONTENT_BYTES;
  }
  // For binary content, don't inline
  return false;
}

function scheduleDispatch(key: string, change: any, debounceMs = DEFAULT_DEBOUNCE_MS) {
  const existing = pending.get(key) || { lastEvent: null, timer: undefined };
  // coalesce: keep the latest event object
  existing.lastEvent = change;

  if (existing.timer) {
    clearTimeout(existing.timer);
  }

  existing.timer = window.setTimeout(async () => {
    pending.delete(key);
    const evt = existing.lastEvent;
    try {
      notifyFileChange(evt);
      coreInfo(`[fileWatcherBridge] Dispatched change ${evt.type} ${evt.projectName}${evt.path}`);
    } catch (e) {
      coreWarn('[fileWatcherBridge] notifyFileChange failed:', e);
    }
  }, debounceMs) as any;

  pending.set(key, existing);
}

export function initFileWatcherBridge(opts?: { debounceMs?: number; maxInlineBytes?: number }) {
  if (initialized) return () => {};
  initialized = true;

  const debounceMs = opts?.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  unsubscribeRepo = fileRepository.addChangeListener(async event => {
    try {
      const projectName = await resolveProjectName(event.projectId);
      // normalize path
      const rawPath = (event.file && (event.file as any).path) || '';
      const path = normalizePath(rawPath);

      // build a lightweight event for dispatch
      const base: any = {
        path,
        projectName,
        type: event.type,
        timestamp: Date.now(),
      };

      // Inline small text content only
      const fileObj = event.file as any;
      if (fileObj && fileObj.content && shouldInlineContent(fileObj.content)) {
        base.content = fileObj.content;
      } else if (fileObj && fileObj.isBufferArray) {
        // mark as binary so listeners can decide to read from FS
        base.isBufferArray = true;
      }

      // Key by projectName + path so events for the same resource are coalesced
      const key = `${projectName}:${path}`;
      scheduleDispatch(key, base, debounceMs);
    } catch (err) {
      coreWarn('[fileWatcherBridge] Error processing repo event:', err);
    }
  });

  // expose destroy/unsubscribe to window for debug/tests
  (window as any).__pyxis_fileWatcherBridge_destroy = destroyFileWatcherBridge;

  return destroyFileWatcherBridge;
}

export function destroyFileWatcherBridge() {
  if (!initialized) return;
  initialized = false;
  // clear pending timers
  for (const [, p] of pending) {
    if (p.timer) clearTimeout(p.timer);
  }
  pending.clear();
  projectNameCache.clear();
  if (unsubscribeRepo) {
    try {
      unsubscribeRepo();
    } catch (e) {
      coreWarn('[fileWatcherBridge] unsubscribe error:', e);
    }
    unsubscribeRepo = null;
  }
}

export default initFileWatcherBridge;
