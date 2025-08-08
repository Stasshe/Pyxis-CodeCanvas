import React from 'react';
import { useTheme } from '@/context/ThemeContext';

interface RightSidebarProps {
  rightSidebarWidth: number;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
}


const RightSidebar: React.FC<RightSidebarProps> = ({ rightSidebarWidth, onResize, children }) => {
  const { colors } = useTheme();
  return (
    <>
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
          zIndex: 20
        }}
      >
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children || (
            <div style={{ padding: 16, color: colors.mutedFg, textAlign: 'center' }}>
              機能開発中
            </div>
          )}
        </div>
      </aside>
    </>
  );
};

export default RightSidebar;
