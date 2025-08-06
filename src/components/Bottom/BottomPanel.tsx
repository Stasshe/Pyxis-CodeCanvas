'use client';

import Terminal from './Terminal';
import OutputPanel, { OutputMessage } from './OutputPanel';
import { FileItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';
import { useState, useRef } from 'react';

interface BottomPanelProps {
  height: number;
  currentProject?: string;
  projectFiles?: FileItem[];
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  onTerminalFileOperation?: (path: string, type: 'file' | 'folder' | 'delete', content?: string, isNodeRuntime?: boolean) => Promise<void>;
}

export const outputMessagesRef: { current: OutputMessage[]; set?: React.Dispatch<React.SetStateAction<OutputMessage[]>> } = { current: [], set: undefined };

export function addOutputPanelMessage(msg: string, type?: 'info' | 'error' | 'warn', context?: string) {
  if (outputMessagesRef.set) {
    outputMessagesRef.set(prev => {
      const next = [...prev, { message: msg, type, context }];
      outputMessagesRef.current = next;
      return next;
    });
  }
}

export default function BottomPanel({ height, currentProject, projectFiles, onResize, onTerminalFileOperation }: BottomPanelProps) {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<'output' | 'terminal'>('terminal');
  const [outputMessages, setOutputMessages] = useState<OutputMessage[]>([]);
  outputMessagesRef.current = outputMessages;
  outputMessagesRef.set = setOutputMessages;

  return (
    <>
      {/* Bottom Resizer（高さ調節バーはそのまま） */}
      <div
        className="resizer resizer-horizontal"
        onMouseDown={onResize}
        onTouchStart={onResize}
      />

      {/* Bottom Panel (Tabs) */}
      <div
        className="flex flex-col bottom-panel-container"
        style={{
          height,
          background: colors.cardBg,
          borderTop: `1px solid ${colors.border}`
        }}
      >
        {/* タブバー */}
        <div
          className="h-8 flex items-center px-3 flex-shrink-0 select-none border-b"
          style={{
            background: colors.mutedBg,
            borderBottom: `1px solid ${colors.border}`
          }}
        >
          <button
            className={`text-xs font-medium uppercase tracking-wide px-2 py-1 rounded transition-colors ${activeTab === 'output' ? 'bg-gray-200' : ''}`}
            style={{ color: colors.mutedFg }}
            onClick={() => setActiveTab('output')}
          >
            出力
          </button>
          <button
            className={`text-xs font-medium uppercase tracking-wide px-2 py-1 rounded ml-2 transition-colors ${activeTab === 'terminal' ? 'bg-gray-200' : ''}`}
            style={{ color: colors.mutedFg }}
            onClick={() => setActiveTab('terminal')}
          >
            ターミナル
          </button>
          {currentProject && (
            <span className="ml-2 text-xs"
              style={{ color: colors.mutedFg }}
            >
              - {currentProject}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden relative">
          {activeTab === 'output' ? (
            <OutputPanel messages={outputMessages} />
          ) : (
            <Terminal
              height={height}
              currentProject={currentProject}
              projectFiles={projectFiles}
              onFileOperation={onTerminalFileOperation}
            />
          )}
        </div>
      </div>
    </>
  );
}
