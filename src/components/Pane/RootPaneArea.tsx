'use client';

import { Fragment, memo } from 'react';

import PaneContainer from '@/components/Pane/PaneContainer';
import type { ThemeColors } from '@/context/ThemeContext';
import type { EditorPane } from '@/engine/tabs/types';

interface RootPaneAreaProps {
  panes: readonly EditorPane[];
  colors: ThemeColors;
  setPanes: (panes: readonly EditorPane[]) => void;
}

function RootPaneArea({ panes, colors, setPanes }: RootPaneAreaProps) {
  return (
    <div className="flex-1 overflow-hidden flex flex-row" style={{ position: 'relative' }}>
      {panes.map((pane, idx) => (
        <Fragment key={pane.id}>
          <div
            style={{
              width: panes.length > 1 ? `${pane.size || 100 / panes.length}%` : '100%',
              height: '100%',
              position: 'relative',
              overflow: 'hidden',
              flexShrink: 0,
              flexGrow: 0,
            }}
          >
            <PaneContainer pane={pane} />
          </div>
          {idx < panes.length - 1 && (
            <div
              style={{
                position: 'relative',
                width: '6px',
                height: '100%',
                flexShrink: 0,
                flexGrow: 0,
                cursor: 'col-resize',
                background: colors.border,
                zIndex: 10,
              }}
              onMouseDown={e => {
                e.preventDefault();
                const startX = e.clientX;
                const startLeftSize = pane.size || 100 / panes.length;
                const startRightSize = panes[idx + 1]?.size || 100 / panes.length;

                const handleMouseMove = (moveEvent: MouseEvent) => {
                  const container = e.currentTarget.parentElement;
                  if (!container) return;

                  const containerWidth = container.clientWidth;
                  const delta = moveEvent.clientX - startX;
                  const deltaPercent = (delta / containerWidth) * 100;
                  const newLeftSize = Math.max(10, Math.min(90, startLeftSize + deltaPercent));
                  const newRightSize = Math.max(10, Math.min(90, startRightSize - deltaPercent));

                  const updatedPanes = [...panes];
                  updatedPanes[idx] = { ...pane, size: newLeftSize };
                  updatedPanes[idx + 1] = {
                    ...updatedPanes[idx + 1],
                    size: newRightSize,
                  };
                  setPanes(updatedPanes);
                };

                const handleMouseUp = () => {
                  document.removeEventListener('mousemove', handleMouseMove);
                  document.removeEventListener('mouseup', handleMouseUp);
                };

                document.addEventListener('mousemove', handleMouseMove);
                document.addEventListener('mouseup', handleMouseUp);
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

export default memo(RootPaneArea);
