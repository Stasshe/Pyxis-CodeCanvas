"use client";

import { useEffect, useMemo, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { useTheme } from '@/context/ThemeContext';
import { useTabStore } from '@/stores/tabStore';

interface ProblemsPanelProps {
  height: number;
  isActive?: boolean;
}

export default function ProblemsPanel({ height, isActive }: ProblemsPanelProps) {
  const { colors } = useTheme();
  const globalActiveTab = useTabStore(state => state.globalActiveTab);
  const panes = useTabStore(state => state.panes);
  const updateTab = useTabStore(state => state.updateTab);

  const [markers, setMarkers] = useState<any[]>([]);

  // find paneId for current globalActiveTab
  const paneIdForActiveTab = useMemo(() => {
    if (!globalActiveTab) return null;
    const findPane = (panesList: any[]): string | null => {
      for (const p of panesList) {
        if (p.tabs && p.tabs.find((t: any) => t.id === globalActiveTab)) return p.id;
        if (p.children) {
          const found = findPane(p.children);
          if (found) return found;
        }
      }
      return null;
    };
    return findPane(panes);
  }, [globalActiveTab, panes]);

  useEffect(() => {
    if (!globalActiveTab) {
      setMarkers([]);
      return;
    }

    let disposable: { dispose?: () => void } | null = null;

    // run in async scope so we can dynamic-import monaco on client only
    (async () => {
      try {
        const monAny = (globalThis as any).monaco;
        const monModule = monAny || (await import('monaco-editor'));
        const mon = monModule as typeof import('monaco-editor');

        // Construct the same inmemory URI used by useMonacoModels
        const normalized = globalActiveTab.startsWith('/') ? globalActiveTab : `/${globalActiveTab}`;
        const expectedUri = mon.Uri.parse(`inmemory://model${normalized}`);

        // Try exact match first, then a few fallbacks that tolerate Windows backslashes
        let model: monaco.editor.ITextModel | null = mon.editor.getModel(expectedUri) || null;
        if (!model) {
          const expectedStr = expectedUri.toString();
          const expectedNorm = expectedStr.replace(/\\/g, '/');
          const expectedPath = expectedUri.path || normalized;
          const expectedPathNorm = expectedPath.replace(/\\/g, '/');

          const found = mon.editor.getModels().find((m: monaco.editor.ITextModel) => {
            try {
              const s = m.uri.toString();
              const sNorm = s.replace(/\\/g, '/');
              const p = m.uri.path || '';
              const pNorm = p.replace(/\\/g, '/');
              return (
                s === expectedStr ||
                sNorm === expectedNorm ||
                p === expectedPath ||
                pNorm.endsWith(expectedPathNorm) ||
                s.endsWith(expectedPath) ||
                sNorm.endsWith(expectedPathNorm)
              );
            } catch (e) {
              return false;
            }
          });
          model = found || null;
        }

        const collect = () => {
          if (!model) {
            setMarkers([]);
            return;
          }

          // Request markers for this specific model/resource
          try {
            const our = mon.editor.getModelMarkers({ resource: model.uri });
            setMarkers(our);
          } catch (e) {
            // fallback: full list filtered
            const all = mon.editor.getModelMarkers({});
            const our = all.filter((mk: any) => mk.resource && mk.resource.toString() === model!.uri.toString());
            setMarkers(our);
          }
        };

        collect();

        // no debug logging in production panel

        disposable = mon.editor.onDidChangeMarkers((uris: readonly monaco.Uri[]) => {
          if (!model) return;
          if (uris.some(u => u.toString() === model!.uri.toString())) {
            collect();
          }
        });
      } catch (e) {
        console.warn('[ProblemsPanel] failed to read markers', e);
        setMarkers([]);
      }
    })();

    return () => {
      try {
        disposable && disposable.dispose && disposable.dispose();
      } catch (e) {}
    };
  }, [globalActiveTab]);

  const handleGoto = (marker: any) => {
    if (!globalActiveTab || !paneIdForActiveTab) return;
    updateTab(paneIdForActiveTab, globalActiveTab, {
      jumpToLine: marker.startLineNumber,
      jumpToColumn: marker.startColumn,
    } as any);
  };

  return (
    <div
      style={{
        height,
        overflow: 'auto',
        padding: '8px',
        background: colors.cardBg,
        color: colors.editorFg,
      }}
    >
      <div style={{ fontSize: 12, marginBottom: 8, color: colors.mutedFg }}>Problems</div>
      {globalActiveTab ? (
        markers.length > 0 ? (
          <div>
            {markers.map((m, idx) => (
              <div
                key={idx}
                onClick={() => handleGoto(m)}
                style={{
                  borderLeft: `3px solid ${m.severity === 8 ? '#D16969' : '#D7BA7D'}`,
                  padding: '6px 8px',
                  marginBottom: 6,
                  cursor: 'pointer',
                  background: colors.mutedBg,
                }}
              >
                <div style={{ fontSize: 12, fontWeight: 600 }}>
                  {m.message.split('\n')[0]}
                </div>
                <div style={{ fontSize: 11, color: colors.mutedFg }}>
                  Line {m.startLineNumber}, Col {m.startColumn} — {m.source || m.owner || ''}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ color: colors.mutedFg, fontSize: 12 }}>No problems found in current file.</div>
        )
      ) : (
        <div style={{ color: colors.mutedFg, fontSize: 12 }}>No active tab selected.</div>
      )}
    </div>
  );
}
