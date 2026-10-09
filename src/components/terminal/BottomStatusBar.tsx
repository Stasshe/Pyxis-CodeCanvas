import React from 'react';
import type { ThemeColors } from '@/context/ThemeContext';
import { formatKeyComboForDisplay, useKeyBindings } from '@/hooks/keybindings/useKeyBindings';

type Props = {
  height?: number;
  currentProjectName?: string;
  gitChangesCount?: number;
  nodeRuntimeBusy?: boolean;
  colors: ThemeColors;
};

export default function BottomStatusBar({
  height = 22,
  currentProjectName,
  gitChangesCount = 0,
  nodeRuntimeBusy = false,
  colors,
}: Props) {
  // Show active chord if any
  const { activeChord, clearActiveChord } = useKeyBindings();

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
      <div className="truncate" style={{ color: colors.mutedFg }}>
        {currentProjectName || 'No Project'}
      </div>
      <div style={{ color: colors.mutedFg }}>|</div>
      <div style={{ color: colors.mutedFg }}>{gitChangesCount} changes</div>
      {activeChord && (
        <button
          type="button"
          style={{
            marginLeft: 8,
            padding: '4px 8px',
            borderRadius: 6,
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            color: colors.foreground,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
            font: 'inherit',
          }}
          title="Press next key for chord or click to cancel"
          onClick={() => clearActiveChord()}
        >
          <span style={{ opacity: 0.7, fontSize: 12 }}>Chord:</span>
          <strong style={{ fontSize: 12 }}>{formatKeyComboForDisplay(activeChord)}</strong>
        </button>
      )}
      <div style={{ marginLeft: 'auto', color: colors.mutedFg }}>
        <span>{nodeRuntimeBusy ? 'Node runtime: busy' : 'Ready'}</span>
        {/* chord badge moved to left side after gitChangesCount */}
      </div>
    </div>
  );
}
