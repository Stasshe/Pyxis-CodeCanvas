'use client';

import React, { useEffect, useState, useMemo } from 'react';
// Do not import monaco-editor at module scope to avoid Node/server-side load errors.
// We'll access the runtime Monaco instance exposed by the editor mount via
// `window.__pyxis_monaco` or dynamically when needed.
import { useTheme } from '@/context/ThemeContext';
import { AlertCircle, AlertTriangle, Info } from 'lucide-react';
import type { FileItem } from '@/types';

type Marker = any;

interface ProblemsPanelProps {
  isActive?: boolean;
  projectFiles?: FileItem[];
  currentProjectId?: string;
}

function severityToLabel(s: number) {
  // Monaco severities are numeric; map to icon/label based on threshold.
  if (typeof s !== 'number') return { label: 'Unknown', icon: <Info size={14} /> };
  if (s >= 8) return { label: 'Error', icon: <AlertCircle size={14} /> };
  if (s >= 4) return { label: 'Warning', icon: <AlertTriangle size={14} /> };
  return { label: 'Info', icon: <Info size={14} /> };
}

export default function ProblemsPanel({
  isActive,
  projectFiles = [],
  currentProjectId,
}: ProblemsPanelProps) {
  const { colors } = useTheme();
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [modelsSummary, setModelsSummary] = useState<
    { uri: string; modeId: string | undefined; markerCount: number }[]
  >([]);

  const getRuntimeMonaco = () => {
    // Prefer the Monaco instance exposed by the editor mount for accurate runtime state.
    // Fallback to global window.monaco if present.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof window === 'undefined') return undefined as any;
    const w = window as any;
    return w.__pyxis_monaco || w.monaco || undefined;
  };

  // Collect models summary using the runtime Monaco instance (if available)
  function collectModels() {
    try {
      const rmon = getRuntimeMonaco() as any;
      if (!rmon || !rmon.editor) return [];
      const models = rmon.editor.getModels();
      const summary = models.map((m: any) => {
        const uri = m.uri ? m.uri.toString() : '(unknown)';
        const modeId = typeof m.getModeId === 'function' ? m.getModeId() : undefined;
        const markersFor = rmon.editor.getModelMarkers({ resource: m.uri }) || [];
        return { uri, modeId, markerCount: markersFor.length };
      });
      setModelsSummary(summary);
      console.debug('[ProblemsPanel] Collected models summary', summary);
      return summary;
    } catch (e) {
      console.warn('[ProblemsPanel] Failed to collect models summary', e);
      return [];
    }
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const getRuntimeMonaco = () => {
      // Prefer the Monaco instance exposed by the editor mount for accurate runtime state.
      // Fallback to global window.monaco if present.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if (typeof window === 'undefined') return undefined;
      const w = window as any;
      return w.__pyxis_monaco || w.monaco || undefined;
    };

    const rmon = getRuntimeMonaco() as any;
    const collectAllMarkers = () => {
      try {
        if (!rmon || !rmon.editor) return;
        const models = rmon.editor.getModels();
        // gather markers per-model to be robust when Monaco loads models dynamically
        const fromModels: any[] = models.flatMap((m: any) =>
          rmon.editor.getModelMarkers({ resource: m.uri })
        );

        // global fallback (some versions/plugins might populate global markers)
        const global = rmon.editor.getModelMarkers({}) || [];

        // merge without duplicates (simple de-dup by message+range+resource)
        const combined: any[] = [];
        const seen = new Set<string>();
        const pushIfNew = (mk: any) => {
          const key = `${mk.message}::${mk.startLineNumber}:${mk.startColumn}::${
            mk.endLineNumber
          }:${mk.endColumn}::${mk.resource ? mk.resource.toString() : 'unknown'}`;
          if (!seen.has(key)) {
            seen.add(key);
            combined.push(mk);
          }
        };

        fromModels.forEach(pushIfNew);
        global.forEach(pushIfNew);

        setMarkers(combined);
        console.debug(
          '[ProblemsPanel] Collected markers',
          combined.length,
          'from models',
          models.length
        );
      } catch (e) {
        console.warn('[ProblemsPanel] Failed to collect markers', e);
      }
    };

    // if runtime monaco isn't ready yet, poll until available
    if (!rmon || !rmon.editor) {
      let tries = 0;
      const poll = setInterval(() => {
        tries += 1;
        const maybe = getRuntimeMonaco() as any;
        if (maybe && maybe.editor) {
          clearInterval(poll);
          try {
            const models = collectModels();
            // call collectAllMarkers now that rmon is available
            collectAllMarkers();
          } catch (e) {}
        } else if (tries > 20) {
          clearInterval(poll);
        }
      }, 300);
      return () => clearInterval(poll);
    }

    // initial
    collectAllMarkers();
    collectModels();

    const dispMarkers = rmon.editor.onDidChangeMarkers((resources: any) => {
      console.debug('[ProblemsPanel] onDidChangeMarkers fired', resources);
      collectAllMarkers();
      collectModels();
    });

    // update when models are created/disposed (Monaco may load models after our component mounts)
    const dispCreate = rmon.editor.onDidCreateModel((model: any) => {
      console.debug('[ProblemsPanel] model created', model.uri && model.uri.toString());
      collectAllMarkers();
      collectModels();
    });
    const dispDispose = rmon.editor.onWillDisposeModel((model: any) => {
      console.debug('[ProblemsPanel] model will dispose', model.uri && model.uri.toString());
      // slight delay to let Monaco update internal marker state
      setTimeout(() => collectAllMarkers(), 50);
      setTimeout(() => collectModels(), 60);
    });

    return () => {
      try {
        dispMarkers.dispose();
      } catch {}
      try {
        dispCreate.dispose();
      } catch {}
      try {
        dispDispose.dispose();
      } catch {}
    };
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, Marker[]>();
    for (const m of markers) {
      let key = '(unknown)';
      try {
        if (m.resource) {
          // resource may be a Uri object or a string depending on Monaco version
          key =
            typeof (m.resource as any).toString === 'function'
              ? (m.resource as any).toString()
              : String(m.resource);
        }
      } catch (e) {
        key = String(m.resource || '(unknown)');
      }
      const arr = map.get(key) || [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [markers]);

  const handleClickMarker = (m: Marker) => {
    try {
      let path: string | undefined = undefined;
      if (m.resource) {
        try {
          path =
            typeof (m.resource as any).toString === 'function'
              ? (m.resource as any).toString()
              : String(m.resource);
        } catch (e) {
          path = String(m.resource);
        }
      }
      const line = m.startLineNumber;
      const column = m.startColumn;
      if (!path) return;
      // Dispatch a global event that page.tsx listens for to open the file and jump
      window.dispatchEvent(new CustomEvent('pyxis-open-file', { detail: { path, line, column } }));
    } catch (e) {
      console.warn('[ProblemsPanel] open marker failed', e);
    }
  };

  return (
    <div
      className="problems-panel h-full overflow-auto"
      style={{ background: colors.cardBg, color: colors.editorFg }}
    >
      <div style={{ padding: '8px 12px', borderBottom: `1px solid ${colors.border}` }}>
        <strong style={{ fontSize: 12 }}>Problems</strong>
        <span style={{ marginLeft: 8, color: colors.mutedFg, fontSize: 12 }}>
          {markers.length} item(s)
        </span>
      </div>

      <div style={{ padding: 8 }}>
        {/* Models summary + debug controls */}
        <div
          style={{
            marginBottom: 10,
            padding: 8,
            border: `1px solid ${colors.border}`,
            borderRadius: 6,
            background: colors.mutedBg,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>Models</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => collectModels()}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  background: colors.cardBg,
                  color: colors.editorFg,
                }}
              >
                Refresh Models
              </button>
              <button
                onClick={() => {
                  try {
                    const rmon = getRuntimeMonaco() as any;
                    if (!rmon || !rmon.editor) return;
                    const models = rmon.editor.getModels();
                    const fromModels = models.flatMap((m: any) =>
                      rmon.editor.getModelMarkers({ resource: m.uri })
                    );
                    const global = rmon.editor.getModelMarkers({}) || [];
                    setMarkers([...fromModels, ...global]);
                    collectModels();
                  } catch (e) {
                    console.warn(e);
                  }
                }}
                style={{
                  fontSize: 11,
                  padding: '4px 8px',
                  borderRadius: 4,
                  border: `1px solid ${colors.border}`,
                  background: colors.cardBg,
                  color: colors.editorFg,
                }}
              >
                Refresh Markers
              </button>
            </div>
          </div>

          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {modelsSummary.length === 0 ? (
              <div style={{ color: colors.mutedFg, fontSize: 12 }}>No models</div>
            ) : (
              modelsSummary.map(ms => (
                <div
                  key={ms.uri}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 12,
                    padding: '4px 6px',
                    borderRadius: 4,
                    background: colors.cardBg,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  <div
                    style={{ color: colors.primary, overflow: 'hidden', textOverflow: 'ellipsis' }}
                  >
                    {ms.uri}
                  </div>
                  <div style={{ color: colors.mutedFg, minWidth: 120, textAlign: 'right' }}>
                    <span style={{ marginRight: 8 }}>{ms.modeId ?? 'unknown'}</span>
                    <span>{ms.markerCount} markers</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {Array.from(grouped.entries()).map(([path, list]) => (
          <div
            key={path}
            style={{ marginBottom: 12, borderRadius: 4 }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 8px',
                background: colors.mutedBg,
                border: `1px solid ${colors.border}`,
                borderRadius: 4,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 12, color: colors.primary }}>{path}</div>
                <div
                  style={{
                    fontSize: 11,
                    color: colors.mutedFg,
                    background: colors.cardBg,
                    padding: '2px 6px',
                    borderRadius: 4,
                    border: `1px solid ${colors.border}`,
                  }}
                >
                  {list.length}
                </div>
              </div>
            </div>

            <div style={{ marginTop: 6 }}>
              {list.map((m, idx) => {
                const sev = severityToLabel(m.severity);
                return (
                  <div
                    key={idx}
                    onClick={() => handleClickMarker(m)}
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '6px 8px',
                      alignItems: 'flex-start',
                      cursor: 'pointer',
                      borderRadius: 4,
                      border: `1px solid ${colors.border}`,
                      marginTop: 6,
                      background: colors.cardBg,
                    }}
                    title={m.message}
                  >
                    <div
                      style={{
                        color:
                          m.severity >= 8
                            ? '#f14c4c'
                            : m.severity >= 4
                              ? '#cca700'
                              : colors.mutedFg,
                      }}
                    >
                      {sev.icon}
                    </div>
                    <div style={{ flex: 1, fontSize: 13 }}>
                      <div style={{ color: colors.editorFg }}>{m.message}</div>
                      <div style={{ color: colors.mutedFg, fontSize: 12, marginTop: 4 }}>
                        {`Line ${m.startLineNumber}, Col ${m.startColumn}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
