'use client';

import { useEffect, useState, useTransition } from 'react';

import OutputPanel from './OutputPanel';
import ProblemsPanel from './ProblemsPanel';
import Terminal from './Terminal';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';

interface BottomPanelProps {
  height: number;
  currentProject?: string;
  currentProjectId?: string;
  onResize: (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => void;
  activeTab?: 'output' | 'terminal' | 'problems';
  onActiveTabChange?: (tab: 'output' | 'terminal' | 'problems') => void;
}

export default function BottomPanel({
  height,
  currentProject,
  currentProjectId,
  onResize,
  activeTab: activeTabProp,
  onActiveTabChange,
}: BottomPanelProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [vimEditor, setVimEditor] = useState<any | null>(null);
  const [internalActiveTab, setInternalActiveTab] = useState<'output' | 'terminal' | 'problems'>(
    'terminal'
  );
  const [mountedTabs, setMountedTabs] = useState<
    Set<'output' | 'terminal' | 'problems'>
  >(() => new Set([activeTabProp ?? 'terminal']));

  const activeTab = typeof activeTabProp !== 'undefined' ? activeTabProp : internalActiveTab;

  useEffect(() => {
    setMountedTabs(prev => {
      if (prev.has(activeTab)) return prev;
      const next = new Set(prev);
      next.add(activeTab);
      return next;
    });
  }, [activeTab]);

  const [, startTransition] = useTransition();

  const setActiveTab = (tab: 'output' | 'terminal' | 'problems') => {
    const current = typeof activeTabProp !== 'undefined' ? activeTabProp : internalActiveTab;
    if (current === tab) return; // avoid unnecessary state updates

    if (onActiveTabChange) {
      startTransition(() => onActiveTabChange(tab));
    } else {
      startTransition(() => setInternalActiveTab(tab));
    }
  };

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
        data-panel="bottom"
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
              color: activeTab === 'terminal' ? colors.primary : colors.mutedFg,
              cursor: 'pointer',
              borderBottom:
                activeTab === 'terminal' ? `2px solid ${colors.primary}` : '2px solid transparent',
              transition: 'color 0.2s, border-bottom 0.2s',
              marginLeft: '2px',
            }}
            onClick={() => setActiveTab('terminal')}
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
                  vimEditor.pressEsc();
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
            {mountedTabs.has('problems') && (
              <ProblemsPanel height={height} isActive={activeTab === 'problems'} />
            )}
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
            {mountedTabs.has('output') && <OutputPanel />}
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
        </div>
      </div>
      {/* Vim ESC button: shown when a VimEditor instance is active */}
    </>
  );
}
