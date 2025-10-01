'use client';

import Terminal from './Terminal';
import OutputPanel, { OutputMessage } from './OutputPanel';
import { FileItem } from '@/types';
import { useTheme } from '@/context/ThemeContext';
import { useState, useRef } from 'react';

interface BottomPanelProps {
  height: number;
  currentProject?: string;
  currentProjectId?: string;
  projectFiles?: FileItem[];
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  onTerminalFileOperation?: (
    path: string,
    type: 'file' | 'folder' | 'delete',
    content?: string,
    isNodeRuntime?: boolean,
    isBufferArray?: boolean,
    bufferContent?: ArrayBuffer
  ) => Promise<void>;
}

const outputMessagesRef: {
  current: OutputMessage[];
  set?: React.Dispatch<React.SetStateAction<OutputMessage[]>>;
} = { current: [], set: undefined };

export function pushMsgOutPanel(
  msg: string,
  type?: 'info' | 'error' | 'warn' | 'check',
  context?: string
) {
  if (outputMessagesRef.set) {
    outputMessagesRef.set(prev => {
      // 直前のメッセージと同じ内容・type・contextなら回数を増やす
      if (prev.length > 0) {
        const last = prev[prev.length - 1];
        if (last.message === msg && last.type === type && last.context === context) {
          // 回数を記録するため、lastにcountプロパティを追加
          const newPrev = [...prev];
          // @ts-ignore
          newPrev[newPrev.length - 1] = { ...last, count: (last.count ?? 1) + 1 };
          outputMessagesRef.current = newPrev;
          return newPrev;
        }
      }
      // 新規メッセージ
      const next = [...prev, { message: msg, type, context }];
      outputMessagesRef.current = next;
      return next;
    });
  }
}

import DebugConsole from './DebugConsole';

export default function BottomPanel({
  height,
  currentProject,
  currentProjectId,
  projectFiles,
  onResize,
  onTerminalFileOperation,
}: BottomPanelProps) {
  const { colors } = useTheme();
  const [activeTab, setActiveTab] = useState<'output' | 'terminal' | 'debug'>('terminal');
  const [outputMessages, setOutputMessages] = useState<OutputMessage[]>([]);
  outputMessagesRef.current = outputMessages;
  outputMessagesRef.set = setOutputMessages;

  return (
    <>
      {/* Bottom Resizer（高さ調節バーはそのまま） */}
      <div
        className="resizer resizer-horizontal"
        style={{
          background: colors.sidebarResizerBg,
          cursor: 'row-resize',
        }}
        onMouseDown={onResize}
        onTouchStart={onResize}
      />

      {/* Bottom Panel (Tabs) */}
      <div
        className="flex flex-col bottom-panel-container"
        style={{
          height,
          background: colors.cardBg,
          borderTop: `1px solid ${colors.border}`,
        }}
      >
        {/* タブバー */}
        <div
          className="h-8 flex items-center px-3 flex-shrink-0 select-none border-b"
          style={{
            background: colors.mutedBg,
            borderBottom: `1px solid ${colors.border}`,
            gap: '2px',
          }}
        >
          <button
            className="tab-btn"
            style={{
              position: 'relative',
              fontSize: '11px',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 12px 0 12px',
              background: 'none',
              border: 'none',
              outline: 'none',
              color: activeTab === 'output' ? colors.primary : colors.mutedFg,
              cursor: 'pointer',
              borderBottom:
                activeTab === 'output' ? `2px solid ${colors.primary}` : `2px solid transparent`,
              transition: 'color 0.2s, border-bottom 0.2s',
            }}
            onClick={() => setActiveTab('output')}
            onMouseOver={e => (e.currentTarget.style.color = colors.primary)}
            onMouseOut={e =>
              (e.currentTarget.style.color =
                activeTab === 'output' ? colors.primary : colors.mutedFg)
            }
          >
            出力
          </button>
          <button
            className="tab-btn"
            style={{
              position: 'relative',
              fontSize: '11px',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 12px 0 12px',
              background: 'none',
              border: 'none',
              outline: 'none',
              color: activeTab === 'debug' ? colors.primary : colors.mutedFg,
              cursor: 'pointer',
              borderBottom:
                activeTab === 'debug' ? `2px solid ${colors.primary}` : `2px solid transparent`,
              transition: 'color 0.2s, border-bottom 0.2s',
              marginLeft: '2px',
            }}
            onClick={() => setActiveTab('debug')}
            onMouseOver={e => (e.currentTarget.style.color = colors.primary)}
            onMouseOut={e =>
              (e.currentTarget.style.color =
                activeTab === 'debug' ? colors.primary : colors.mutedFg)
            }
          >
            デバッグコンソール
          </button>
          <button
            className="tab-btn"
            style={{
              position: 'relative',
              fontSize: '11px',
              fontWeight: 500,
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
              padding: '2px 12px 0 12px',
              background: 'none',
              border: 'none',
              outline: 'none',
              color: activeTab === 'terminal' ? colors.primary : colors.mutedFg,
              cursor: 'pointer',
              borderBottom:
                activeTab === 'terminal' ? `2px solid ${colors.primary}` : `2px solid transparent`,
              transition: 'color 0.2s, border-bottom 0.2s',
              marginLeft: '2px',
            }}
            onClick={() => setActiveTab('terminal')}
            onMouseOver={e => (e.currentTarget.style.color = colors.primary)}
            onMouseOut={e =>
              (e.currentTarget.style.color =
                activeTab === 'terminal' ? colors.primary : colors.mutedFg)
            }
          >
            ターミナル
          </button>
          {currentProject && (
            <span
              className="ml-2 text-xs"
              style={{ color: colors.mutedFg, fontSize: '10px', marginLeft: '8px' }}
            >
              - {currentProject}
            </span>
          )}
        </div>
        <div className="flex-1 overflow-hidden relative">
          {/* 3つのパネルを同時にマウントし、visibility/positionで切り替え（xterm.jsの幅崩れ対策） */}
          <div
            style={{
              height: '100%',
              width: '100%',
              position: activeTab === 'output' ? 'static' : 'absolute',
              visibility: activeTab === 'output' ? 'visible' : 'hidden',
              pointerEvents: activeTab === 'output' ? 'auto' : 'none',
              top: 0,
              left: 0,
            }}
          >
            <OutputPanel messages={outputMessages} />
          </div>
          <div
            style={{
              height: '100%',
              width: '100%',
              position: activeTab === 'terminal' ? 'static' : 'absolute',
              visibility: activeTab === 'terminal' ? 'visible' : 'hidden',
              pointerEvents: activeTab === 'terminal' ? 'auto' : 'none',
              top: 0,
              left: 0,
            }}
          >
            <Terminal
              height={height}
              currentProject={currentProject}
              currentProjectId={currentProjectId}
              isActive={activeTab === 'terminal'}
            />
          </div>
          <div
            style={{
              height: '100%',
              width: '100%',
              position: activeTab === 'debug' ? 'static' : 'absolute',
              visibility: activeTab === 'debug' ? 'visible' : 'hidden',
              pointerEvents: activeTab === 'debug' ? 'auto' : 'none',
              top: 0,
              left: 0,
            }}
          >
            <DebugConsole
              height={height}
              isActive={activeTab === 'debug'}
            />
          </div>
        </div>
      </div>
    </>
  );
}
