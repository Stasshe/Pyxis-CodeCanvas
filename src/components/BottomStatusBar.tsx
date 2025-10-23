import React from 'react';

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
  return (
    <div
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
        {nodeRuntimeBusy ? 'Node runtime: busy' : 'Ready'}
      </div>
    </div>
  );
}
