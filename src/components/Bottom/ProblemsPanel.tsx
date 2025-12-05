"use client";

import { useEffect, useMemo, useState } from 'react';
import type * as monaco from 'monaco-editor';
import { useTheme } from '@/context/ThemeContext';
import { useTabStore } from '@/stores/tabStore';

interface ProblemsPanelProps {
  height: number;
  isActive?: boolean;
}

// Marker with file info for display
interface MarkerWithFile {
  marker: any;
  filePath: string;
  fileName: string;
}

export default function ProblemsPanel({ height, isActive }: ProblemsPanelProps) {
  const { colors } = useTheme();
  const globalActiveTab = useTabStore(state => state.globalActiveTab);
  const panes = useTabStore(state => state.panes);
  const updateTab = useTabStore(state => state.updateTab);
  const activateTab = useTabStore(state => state.activateTab);

  const [allMarkers, setAllMarkers] = useState<MarkerWithFile[]>([]);
  const [showImportErrors, setShowImportErrors] = useState<boolean>(false);

  // Helper to find paneId for a tabId
  const findPaneIdForTab = useMemo(() => {
    return (tabId: string): string | null => {
      const findPane = (panesList: any[]): string | null => {
        for (const p of panesList) {
          if (p.tabs && p.tabs.find((t: any) => t.id === tabId)) return p.id;
          if (p.children) {
            const found = findPane(p.children);
            if (found) return found;
          }
        }
        return null;
      };
      return findPane(panes);
    };
  }, [panes]);

  useEffect(() => {
    let disposable: { dispose?: () => void } | null = null;

    // run in async scope so we can dynamic-import monaco on client only
    (async () => {
      try {
        const monAny = (globalThis as any).monaco;
        const monModule = monAny || (await import('monaco-editor'));
        const mon = monModule as typeof import('monaco-editor');

        const collectAllMarkers = () => {
          // Get all models in Monaco
          const models = mon.editor.getModels();
          const markersWithFiles: MarkerWithFile[] = [];

          for (const model of models) {
            try {
              // Get markers for this model
              const modelMarkers = mon.editor.getModelMarkers({ resource: model.uri });
              
              // Extract file path from URI
              const uriStr = model.uri.toString();
              // URI format: inmemory://model/path/to/file
              let filePath = model.uri.path || '';
              if (filePath.startsWith('/')) {
                filePath = filePath.substring(1);
              }
              // Remove any timestamp suffixes added for uniqueness
              filePath = filePath.replace(/__\d+$/, '');
              
              const fileName = filePath.split('/').pop() || filePath;

              for (const marker of modelMarkers) {
                markersWithFiles.push({
                  marker,
                  filePath,
                  fileName,
                });
              }
            } catch (e) {
              // Skip models that fail
            }
          }

          setAllMarkers(markersWithFiles);
        };

        collectAllMarkers();

        // Listen to marker changes on any model
        disposable = mon.editor.onDidChangeMarkers(() => {
          collectAllMarkers();
        });
      } catch (e) {
        console.warn('[ProblemsPanel] failed to read markers', e);
        setAllMarkers([]);
      }
    })();

    return () => {
      try {
        disposable && disposable.dispose && disposable.dispose();
      } catch (e) {}
    };
  }, []);

  const handleGoto = (markerWithFile: MarkerWithFile) => {
    const { marker, filePath } = markerWithFile;
    
    // Find the tab and pane for this file
    const tabId = filePath.startsWith('/') ? filePath : `/${filePath}`;
    const paneId = findPaneIdForTab(tabId) || findPaneIdForTab(filePath);
    
    if (paneId) {
      // Activate the tab first
      activateTab(paneId, tabId.startsWith('/') ? tabId : filePath);
      
      // Then update with jump info
      updateTab(paneId, tabId.startsWith('/') ? tabId : filePath, {
        jumpToLine: marker.startLineNumber,
        jumpToColumn: marker.startColumn,
      } as any);
    }
  };

  const displayedMarkers = allMarkers.filter(m => {
    if (showImportErrors) return true;
    // Hide multi-file import resolution errors like: "Cannot find module './math' or its corresponding type declarations."
    const msg = (m.marker.message || '').toString();
    if (/Cannot find module\b/i.test(msg)) return false;
    if (/corresponding type declarations/i.test(msg)) return false;
    return true;
  });

  // Group markers by file
  const markersByFile = useMemo(() => {
    const grouped: Map<string, MarkerWithFile[]> = new Map();
    for (const m of displayedMarkers) {
      const key = m.filePath;
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(m);
    }
    return grouped;
  }, [displayedMarkers]);

  const totalProblems = displayedMarkers.length;
  const errorCount = displayedMarkers.filter(m => m.marker.severity === 8).length;
  const warningCount = displayedMarkers.filter(m => m.marker.severity === 4).length;

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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 8 }}>
        <div>
          <div style={{ fontSize: 12, marginBottom: 6, color: colors.mutedFg }}>
            Problems ({totalProblems})
            {errorCount > 0 && <span style={{ color: '#D16969', marginLeft: 8 }}>Errors: {errorCount}</span>}
            {warningCount > 0 && <span style={{ color: '#D7BA7D', marginLeft: 8 }}>Warnings: {warningCount}</span>}
          </div>
          <div style={{ fontSize: 11, color: colors.mutedFg }}>
            注意: この機能はベータ版です。検出されたエラーは誤検出の可能性があります。
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            onClick={() => setShowImportErrors(prev => !prev)}
            style={{
              fontSize: 12,
              padding: '4px 8px',
              background: showImportErrors ? colors.primary : 'transparent',
              color: showImportErrors ? '#fff' : colors.mutedFg,
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {showImportErrors ? 'インポートエラーを表示' : 'インポートエラーを非表示'}
          </button>
        </div>
      </div>

      {totalProblems > 0 ? (
        <div>
          {Array.from(markersByFile.entries()).map(([filePath, fileMarkers]) => (
            <div key={filePath} style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4, color: colors.editorFg }}>
                {fileMarkers[0]?.fileName || filePath}
                <span style={{ fontWeight: 400, color: colors.mutedFg, marginLeft: 8 }}>
                  ({fileMarkers.length})
                </span>
              </div>
              {fileMarkers.map((m, idx) => (
                <div
                  key={idx}
                  onClick={() => handleGoto(m)}
                  style={{
                    borderLeft: `3px solid ${m.marker.severity === 8 ? '#D16969' : '#D7BA7D'}`,
                    padding: '6px 8px',
                    marginBottom: 4,
                    marginLeft: 8,
                    cursor: 'pointer',
                    background: colors.mutedBg,
                  }}
                >
                  <div style={{ fontSize: 12 }}>
                    {m.marker.message.split('\n')[0]}
                  </div>
                  <div style={{ fontSize: 11, color: colors.mutedFg }}>
                    Line {m.marker.startLineNumber}, Col {m.marker.startColumn} — {m.marker.source || m.marker.owner || ''}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {displayedMarkers.length !== allMarkers.length && (
            <div style={{ fontSize: 11, color: colors.mutedFg, marginTop: 6 }}>
              一部のエラーを非表示にしています。表示するには上のボタンを切り替えてください。
            </div>
          )}
        </div>
      ) : (
        <div style={{ color: colors.mutedFg, fontSize: 12 }}>No problems found in any open models.</div>
      )}
    </div>
  );
}
