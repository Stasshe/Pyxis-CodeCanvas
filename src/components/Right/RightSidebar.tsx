import React, { lazy, Suspense } from 'react';

import { useTheme } from '@/context/ThemeContext';
import type { FileItem, Project } from '@/types';

const AIPanel = lazy(() => import('@/components/AI/AIPanel'));

interface RightSidebarProps {
  rightSidebarWidth: number;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
  // AI Agent用のプロパティ
  projectFiles?: FileItem[];
  currentProject?: Project | null;
  currentProjectId?: string;
}

const RightSidebar: React.FC<RightSidebarProps> = ({
  rightSidebarWidth,
  onResize,
  children,
  projectFiles = [],
  currentProject = null,
  currentProjectId = '',
}) => {
  const { colors } = useTheme();

  return (
    <>
      <div
        className="resizer resizer-vertical flex-shrink-0"
        onMouseDown={onResize}
        onTouchStart={onResize}
        style={{
          background: colors.sidebarResizerBg,
          cursor: 'col-resize',
        }}
      />
      <aside
        data-sidebar="right"
        className="flex flex-col flex-shrink-0"
        style={{
          background: colors.accentBg,
          borderLeft: `1px solid ${colors.border}`,
          width: `${rightSidebarWidth}px`,
          minWidth: `${rightSidebarWidth}px`,
          maxWidth: `${rightSidebarWidth}px`,
          height: '100%',
          zIndex: 20,
        }}
      >
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children || (
            // デフォルトでAI Panelを表示
            <Suspense fallback={null}>
              <AIPanel
                projectFiles={projectFiles}
                currentProject={currentProject}
                currentProjectId={currentProjectId}
              />
            </Suspense>
          )}
        </div>
      </aside>
    </>
  );
};

// Memoize to avoid unnecessary re-renders when parent updates unrelated state
export default React.memo(RightSidebar);
