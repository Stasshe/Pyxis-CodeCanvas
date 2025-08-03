import Terminal from './Terminal';
import { FileItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';

interface BottomPanelProps {
  height: number;
  currentProject?: string;
  projectFiles?: FileItem[];
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  onTerminalFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;
}

export default function BottomPanel({ height, currentProject, projectFiles, onResize, onTerminalFileOperation }: BottomPanelProps) {
  const { colors } = useTheme();
  return (
    <>
      {/* Bottom Resizer（高さ調節バーはそのまま） */}
      <div
        className="resizer resizer-horizontal"
        onMouseDown={onResize}
        onTouchStart={onResize}
      />

      {/* Bottom Panel (Terminal) */}
      <div
        className="flex flex-col bottom-panel-container"
        style={{
          height,
          background: colors.cardBg,
          borderTop: `1px solid ${colors.border}`
        }}
      >
        <div
          className="h-8 flex items-center px-3 flex-shrink-0 select-none"
          style={{
            background: colors.mutedBg,
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <span
            className="text-xs font-medium uppercase tracking-wide"
            style={{ color: colors.mutedFg }}
          >
            ターミナル
          </span>
          {currentProject && (
            <span className="ml-2 text-xs"
              style={{ color: colors.mutedFg }}
            >
              - {currentProject}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden relative">
          <Terminal
            height={height}
            currentProject={currentProject}
            projectFiles={projectFiles}
            onFileOperation={onTerminalFileOperation}
          />
        </div>
      </div>
    </>
  );
}
