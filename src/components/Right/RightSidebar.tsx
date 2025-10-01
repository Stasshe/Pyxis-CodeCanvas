import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import AIPanel from '@/components/AI/AIPanel';
import type { FileItem, Project, Tab } from '@/types';

interface RightSidebarProps {
  rightSidebarWidth: number;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  children?: React.ReactNode;
  // AI Agent用のプロパティ
  projectFiles?: FileItem[];
  currentProject?: Project | null;
  currentProjectId?: string;
  tabs?: Tab[];
  setTabs?: (update: any) => void;
  setActiveTabId?: (id: string) => void;
  saveFile?: (filePath: string, content: string) => Promise<void>;
  clearAIReview?: (filePath: string) => Promise<void>;
}

const RightSidebar: React.FC<RightSidebarProps> = ({
  rightSidebarWidth,
  onResize,
  children,
  projectFiles = [],
  currentProject = null,
  currentProjectId = '',
  tabs = [],
  setTabs,
  setActiveTabId,
  saveFile,
  clearAIReview,
}) => {
  const { colors } = useTheme();

  // AIレビューをクリアする関数
  const handleClearAIReview = async (filePath: string): Promise<void> => {
    if (clearAIReview) {
      await clearAIReview(filePath);
    }
  };

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
          zIndex: 20,
        }}
      >
        <div style={{ flex: 1, overflow: 'auto' }}>
          {children ||
            // デフォルトでAI Panelを表示
            (setTabs && setActiveTabId && saveFile ? (
              <AIPanel
                projectFiles={projectFiles}
                currentProject={currentProject}
                currentProjectId={currentProjectId}
                tabs={tabs}
                setTabs={setTabs}
                setActiveTabId={setActiveTabId}
                saveFile={saveFile}
                clearAIReview={handleClearAIReview}
              />
            ) : (
              <div style={{ padding: 16, color: colors.mutedFg, textAlign: 'center' }}>
                AI Assistant機能が利用できません
              </div>
            ))}
        </div>
      </aside>
    </>
  );
};

export default RightSidebar;
