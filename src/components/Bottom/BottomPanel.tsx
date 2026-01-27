'use client';

import { useState } from 'react';

import DebugConsole from './DebugConsole';
import OutputPanel, { type OutputMessage } from './OutputPanel';
import ProblemsPanel from './ProblemsPanel';
import Terminal from './Terminal';

import { OUTPUT_CONFIG } from '@/constants/config';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import type { FileItem } from '@/types';

interface BottomPanelProps {
  height: number;
  currentProject?: string;
  currentProjectId?: string;
  projectFiles?: FileItem[];
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  activeTab?: 'output' | 'terminal' | 'debug' | 'problems';
  onActiveTabChange?: (tab: 'output' | 'terminal' | 'debug' | 'problems') => void;
  // [NEW ARCHITECTURE] onTerminalFileOperation removed - Terminal uses fileRepository directly
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
          // Trim if over limit
          const max = OUTPUT_CONFIG.OUTPUT_MAX_MESSAGES ?? 30;
          if (newPrev.length > max) {
            const start = newPrev.length - max;
            const trimmed = newPrev.slice(start);
            outputMessagesRef.current = trimmed;
            return trimmed;
          }
          outputMessagesRef.current = newPrev;
          return newPrev;
        }
      }
      // 新規メッセージ
      const next = [...prev, { message: msg, type, context }];
      // Trim to keep only the most recent OUTPUT_MAX_MESSAGES
      const max = OUTPUT_CONFIG.OUTPUT_MAX_MESSAGES ?? 30;
      if (next.length > max) {
        const start = next.length - max;
        const trimmed = next.slice(start);
        outputMessagesRef.current = trimmed;
        return trimmed;
      }
      outputMessagesRef.current = next;
      return next;
    });
  }
}

export default function BottomPanel({
  height,
  currentProject,
  currentProjectId,
  projectFiles,
  onResize,
  activeTab: activeTabProp,
  onActiveTabChange,
}: BottomPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [vimEditor, setVimEditor] = useState<any | null>(null);
  const [internalActiveTab, setInternalActiveTab] = useState<
    'output' | 'terminal' | 'debug' | 'problems'
  >('terminal');

  const activeTab = typeof activeTabProp !== 'undefined' ? activeTabProp : internalActiveTab;

  const setActiveTab = (tab: 'output' | 'terminal' | 'debug' | 'problems') => {
    if (onActiveTabChange) onActiveTabChange(tab);
    else setInternalActiveTab(tab);
  };
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
          position: 'relative',
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
              color: activeTab === 'problems' ? colors.primary : colors.mutedFg,
              cursor: 'pointer',
              borderBottom:
                activeTab === 'problems' ? `2px solid ${colors.primary}` : '2px solid transparent',
              transition: 'color 0.2s, border-bottom 0.2s',
            }}
            onClick={() => setActiveTab('problems')}
            onMouseOver={e => (e.currentTarget.style.color = colors.primary)}
            onMouseOut={e =>
              (e.currentTarget.style.color =
                activeTab === 'problems' ? colors.primary : colors.mutedFg)
            }
          >
            {t('bottom.problems')}
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
              color: activeTab === 'output' ? colors.primary : colors.mutedFg,
              cursor: 'pointer',
              borderBottom:
                activeTab === 'output' ? `2px solid ${colors.primary}` : '2px solid transparent',
              transition: 'color 0.2s, border-bottom 0.2s',
            }}
            onClick={() => setActiveTab('output')}
            onMouseOver={e => (e.currentTarget.style.color = colors.primary)}
            onMouseOut={e =>
              (e.currentTarget.style.color =
                activeTab === 'output' ? colors.primary : colors.mutedFg)
            }
          >
            {t('bottom.output')}
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
                activeTab === 'debug' ? `2px solid ${colors.primary}` : '2px solid transparent',
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
            {t('bottom.debugConsole')}
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
                activeTab === 'terminal' ? `2px solid ${colors.primary}` : '2px solid transparent',
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
            {t('bottom.terminal')}
          </button>
          {currentProject && (
            <span
              className="ml-2 text-xs"
              style={{ color: colors.mutedFg, fontSize: '10px', marginLeft: '8px' }}
            >
              - {currentProject}
            </span>
          )}
          {/* Place ESC button at the far right of the tab bar when vim is active */}
          {vimEditor && (
            <button
              onClick={() => {
                try {
                  if (typeof vimEditor.pressEsc === 'function') {
                    vimEditor.pressEsc();
                  }
                } catch (e) {}
              }}
              title={t('bottom.escButton') ?? 'Esc'}
              className="pyxis-esc-btn"
              style={{
                marginLeft: 'auto',
                background: colors.cardBg,
                color: colors.mutedFg,
                border: `1px solid ${colors.border}`,
                padding: '4px 8px',
                borderRadius: 4,
                fontSize: 12,
                cursor: 'pointer',
              }}
            >
              Esc
            </button>
          )}
        </div>
        <div className="flex-1 overflow-hidden relative">
          {/* 3つのパネルを同時にマウントし、visibility/positionで切り替え（xterm.jsの幅崩れ対策） */}
          <div
            style={{
              height: '100%',
              width: '100%',
              position: activeTab === 'problems' ? 'static' : 'absolute',
              visibility: activeTab === 'problems' ? 'visible' : 'hidden',
              pointerEvents: activeTab === 'problems' ? 'auto' : 'none',
              top: 0,
              left: 0,
            }}
          >
            <ProblemsPanel height={height} isActive={activeTab === 'problems'} />
          </div>

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
            <OutputPanel
              messages={outputMessages}
              onClearDisplayed={toClear => {
                // Remove the currently displayed (filtered) messages from the full messages list
                setOutputMessages(prev => prev.filter(m => !toClear.includes(m)));
              }}
            />
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
              onVimModeChange={editor => setVimEditor(editor)}
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
            <DebugConsole height={height} isActive={activeTab === 'debug'} />
          </div>
        </div>
      </div>
      {/* Vim ESC button: shown when a VimEditor instance is active */}
    </>
  );
}
