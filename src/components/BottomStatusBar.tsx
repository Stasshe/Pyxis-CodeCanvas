import React, { useEffect, useMemo, useState, useRef } from 'react';
import { syncManager } from '@/engine/core/syncManager';
import { Loader2Icon, CheckCircle2 } from 'lucide-react';

type Props = {
  height?: number;
  currentProjectName?: string;
  gitChangesCount?: number;
  nodeRuntimeBusy?: boolean;
  colors: any;
};

export default function BottomStatusBar({
  height = 22,
  currentProjectName,
  gitChangesCount = 0,
  nodeRuntimeBusy = false,
  colors,
}: Props) {
  // debounce config to avoid quick flicker when syncs are short
  const SHOW_DELAY = 5; // ms - only show syncing indicator if sync lasts longer than this
  const MIN_VISIBLE_AFTER_STOP = 10; // ms - keep 'Synced' or syncing indicator visible after stop to avoid flicker

  const [isSyncing, setIsSyncing] = useState(false);
  const syncingCount = useRef(0);
  const showTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    const onStart = () => {
      // increment active syncs
      syncingCount.current += 1;

      // if already visible, nothing to do; otherwise schedule show after delay
      if (!isSyncing && showTimer.current == null) {
        showTimer.current = window.setTimeout(() => {
          setIsSyncing(true);
          showTimer.current = null;
        }, SHOW_DELAY);
      }
      // if a hideTimer is pending (we recently stopped), cancel it so indicator remains
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
    };

    const onStop = () => {
      // decrement active syncs
      syncingCount.current = Math.max(0, syncingCount.current - 1);

      // if there's still active syncs, keep showing
      if (syncingCount.current > 0) return;

      // cancel any pending show
      if (showTimer.current) {
        clearTimeout(showTimer.current);
        showTimer.current = null;
      }

      // if not currently visible, nothing to do
      if (!isSyncing) return;

      // keep visible for a short grace period to avoid flicker
      if (hideTimer.current == null) {
        hideTimer.current = window.setTimeout(() => {
          setIsSyncing(false);
          hideTimer.current = null;
        }, MIN_VISIBLE_AFTER_STOP);
      }
    };

    syncManager.on('sync:start', onStart);
    syncManager.on('sync:stop', onStop);

    return () => {
      syncManager.off('sync:start', onStart);
      syncManager.off('sync:stop', onStop);
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [isSyncing]);

  return (
    <div
      className="select-none"
      style={{
        height,
        background: colors.mutedBg,
        borderTop: `1px solid ${colors.border}`,
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 8,
        paddingRight: 8,
        gap: 12,
        fontSize: 12,
      }}
    >
      <div
        className="truncate"
        style={{ color: colors.mutedFg }}
      >
        {currentProjectName || 'No Project'}
      </div>
      <div style={{ color: colors.mutedFg }}>|</div>
      <div style={{ color: colors.mutedFg }}>{gitChangesCount} changes</div>
      <div style={{ marginLeft: 'auto', color: colors.mutedFg }}>
        {/* sync status + node runtime status */}
        <span style={{ marginRight: 12, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          {isSyncing ? (
            <>
              <Loader2Icon
                className="animate-spin"
                color={colors.mutedFg}
                size={14}
              />
              <span>Syncing...</span>
            </>
          ) : (
            <>
              <CheckCircle2
                color={colors.mutedFg}
                size={14}
              />
              <span>Synced</span>
            </>
          )}
        </span>
        <span>{nodeRuntimeBusy ? 'Node runtime: busy' : 'Ready'}</span>
      </div>
    </div>
  );
}
