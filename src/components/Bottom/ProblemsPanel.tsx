'use client';

import { useTheme } from '@/context/ThemeContext';
import { useTabStore } from '@/stores/tabStore';
import { loader } from '@monaco-editor/react';
import { ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import type * as monaco from 'monaco-editor';
import { useCallback, useEffect, useMemo, useState } from 'react';

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

// File extensions to exclude from problems display
const EXCLUDED_EXTENSIONS = ['.txt', '.md', '.markdown'];

function shouldExcludeFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return EXCLUDED_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// Check if marker owner matches the file type
// This filters out TypeScript diagnostics for non-TS/JS files
function isMarkerOwnerValidForFile(fileName: string, owner: string): boolean {
  const lower = fileName.toLowerCase();
  const ownerLower = (owner || '').toLowerCase();

  // TypeScript/JavaScript markers should only apply to TS/JS/JSX/TSX files
  if (ownerLower === 'typescript' || ownerLower === 'javascript') {
    return (
      lower.endsWith('.ts') ||
      lower.endsWith('.tsx') ||
      lower.endsWith('.js') ||
      lower.endsWith('.jsx') ||
      lower.endsWith('.mts') ||
      lower.endsWith('.cts') ||
      lower.endsWith('.mjs') ||
      lower.endsWith('.cjs')
    );
  }

  // CSS markers should only apply to CSS/SCSS/LESS files
  if (ownerLower === 'css' || ownerLower === 'scss' || ownerLower === 'less') {
    return (
      lower.endsWith('.css') ||
      lower.endsWith('.scss') ||
      lower.endsWith('.less') ||
      lower.endsWith('.sass')
    );
  }

  // JSON markers should only apply to JSON files
  if (ownerLower === 'json') {
    return lower.endsWith('.json') || lower.endsWith('.jsonc');
  }

  // HTML markers should only apply to HTML files
  if (ownerLower === 'html') {
    return lower.endsWith('.html') || lower.endsWith('.htm') || lower.endsWith('.xhtml');
  }

  // Allow other markers (unknown owners)
  return true;
}

export default function ProblemsPanel({ height, isActive }: ProblemsPanelProps) {
  const { colors } = useTheme();
  const globalActiveTab = useTabStore(state => state.globalActiveTab);
  const panes = useTabStore(state => state.panes);
  const updateTab = useTabStore(state => state.updateTab);
  const activateTab = useTabStore(state => state.activateTab);

  const [allMarkers, setAllMarkers] = useState<MarkerWithFile[]>([]);
  const [showImportErrors, setShowImportErrors] = useState<boolean>(false);
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(new Set());
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Helper to find paneId for a tabId
  const findPaneIdForTab = useMemo(() => {
    return (tabId: string): string | null => {
      const findPane = (panesList: any[]): string | null => {
        for (const p of panesList) {
          if (p.tabs?.find((t: any) => t.id === tabId)) return p.id;
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

  // Manual refresh
  const handleRefresh = useCallback(() => {
    setRefreshCounter(c => c + 1);
  }, []);

  useEffect(() => {
    let disposable: { dispose?: () => void } | null = null;
    let isCancelled = false;

    // Use @monaco-editor/react's loader to get Monaco instance
    loader
      .init()
      .then(mon => {
        if (isCancelled) return;

        const collectAllMarkers = () => {
          if (isCancelled) return;

          try {
            // Get ALL markers from Monaco
            const allMonacoMarkers = mon.editor.getModelMarkers({});
            const markersWithFiles: MarkerWithFile[] = [];

            for (const marker of allMonacoMarkers) {
              try {
                // Extract file path from the marker's resource URI
                let filePath = marker.resource?.path || '';
                if (filePath.startsWith('/')) {
                  filePath = filePath.substring(1);
                }
                // Remove any timestamp suffixes added for uniqueness
                filePath = filePath.replace(/__\d+$/, '');

                const fileName = filePath.split('/').pop() || filePath;

                // Skip excluded file types
                if (shouldExcludeFile(fileName)) {
                  continue;
                }

                // Skip markers where the owner doesn't match the file type
                // (e.g., TypeScript errors for CSS files)
                if (!isMarkerOwnerValidForFile(fileName, marker.owner)) {
                  continue;
                }

                markersWithFiles.push({
                  marker,
                  filePath,
                  fileName,
                });
              } catch (e) {
                // Skip markers that fail
              }
            }

            if (!isCancelled) {
              setAllMarkers(markersWithFiles);
            }
          } catch (e) {
            console.warn('[ProblemsPanel] failed to collect markers', e);
          }
        };

        // Initial collection
        collectAllMarkers();

        // Listen to marker changes
        disposable = mon.editor.onDidChangeMarkers(() => {
          collectAllMarkers();
        });
      })
      .catch(e => {
        console.warn('[ProblemsPanel] failed to initialize Monaco', e);
      });

    return () => {
      isCancelled = true;
      try {
        if (disposable?.dispose) {
          disposable.dispose();
        }
      } catch (e) {}
    };
  }, [refreshCounter]);

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

  const toggleFileCollapse = (filePath: string) => {
    setCollapsedFiles(prev => {
      const newSet = new Set(prev);
      if (newSet.has(filePath)) {
        newSet.delete(filePath);
      } else {
        newSet.add(filePath);
      }
      return newSet;
    });
  };

  const displayedMarkers = allMarkers.filter(m => {
    if (showImportErrors) return true;
    // Hide multi-file import resolution errors
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
      grouped.get(key)?.push(m);
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
        padding: '6px 8px',
        background: colors.cardBg,
        color: colors.editorFg,
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ fontSize: 11, color: colors.mutedFg }}>
          Problems ({totalProblems})
          {errorCount > 0 && (
            <span style={{ color: '#D16969', marginLeft: 6 }}>E:{errorCount}</span>
          )}
          {warningCount > 0 && (
            <span style={{ color: '#D7BA7D', marginLeft: 6 }}>W:{warningCount}</span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <button
            onClick={handleRefresh}
            style={{
              fontSize: 10,
              padding: '2px 4px',
              background: 'transparent',
              color: colors.mutedFg,
              border: `1px solid ${colors.border}`,
              borderRadius: 3,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
            }}
            title="Refresh"
          >
            <RefreshCw style={{ width: 10, height: 10 }} />
          </button>
          <button
            onClick={() => setShowImportErrors(prev => !prev)}
            style={{
              fontSize: 10,
              padding: '2px 6px',
              background: showImportErrors ? colors.primary : 'transparent',
              color: showImportErrors ? '#fff' : colors.mutedFg,
              border: `1px solid ${colors.border}`,
              borderRadius: 3,
              cursor: 'pointer',
            }}
          >
            {showImportErrors ? 'Import表示' : 'Import非表示'}
          </button>
        </div>
      </div>

      {totalProblems > 0 ? (
        <div>
          {Array.from(markersByFile.entries()).map(([filePath, fileMarkers]) => {
            const isCollapsed = collapsedFiles.has(filePath);
            const fileErrorCount = fileMarkers.filter(m => m.marker.severity === 8).length;
            const fileWarnCount = fileMarkers.filter(m => m.marker.severity === 4).length;

            return (
              <div key={filePath} style={{ marginBottom: 4 }}>
                <div
                  onClick={() => toggleFileCollapse(filePath)}
                  style={{
                    fontSize: 11,
                    fontWeight: 500,
                    padding: '3px 4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    background: colors.mutedBg,
                    borderRadius: 2,
                  }}
                >
                  {isCollapsed ? (
                    <ChevronRight style={{ width: 12, height: 12 }} />
                  ) : (
                    <ChevronDown style={{ width: 12, height: 12 }} />
                  )}
                  <span style={{ flex: 1 }}>{fileMarkers[0]?.fileName || filePath}</span>
                  <span style={{ fontSize: 10, color: colors.mutedFg }}>
                    {fileErrorCount > 0 && (
                      <span style={{ color: '#D16969', marginRight: 4 }}>{fileErrorCount}</span>
                    )}
                    {fileWarnCount > 0 && <span style={{ color: '#D7BA7D' }}>{fileWarnCount}</span>}
                  </span>
                </div>
                {!isCollapsed && (
                  <div style={{ marginLeft: 16 }}>
                    {fileMarkers.map((m, idx) => (
                      <div
                        key={idx}
                        onClick={() => handleGoto(m)}
                        style={{
                          borderLeft: `2px solid ${m.marker.severity === 8 ? '#D16969' : '#D7BA7D'}`,
                          padding: '2px 6px',
                          marginTop: 2,
                          cursor: 'pointer',
                          fontSize: 10,
                          lineHeight: 1.3,
                        }}
                      >
                        <span style={{ color: colors.mutedFg, marginRight: 4 }}>
                          {m.marker.startLineNumber}:{m.marker.startColumn}
                        </span>
                        <span>
                          {m.marker.message.split('\n')[0].substring(0, 80)}
                          {m.marker.message.length > 80 ? '...' : ''}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
          {displayedMarkers.length !== allMarkers.length && (
            <div style={{ fontSize: 10, color: colors.mutedFg, marginTop: 4 }}>一部非表示中</div>
          )}
        </div>
      ) : (
        <div style={{ color: colors.mutedFg, fontSize: 11 }}>No problems</div>
      )}
    </div>
  );
}
