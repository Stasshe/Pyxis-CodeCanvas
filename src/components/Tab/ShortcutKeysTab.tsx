'use client';

import {
  Edit2,
  RefreshCw,
  X,
  Search,
  Command,
  Keyboard,
  File,
  Eye,
  Play,
  GitBranch,
  Folder,
  Settings,
  Grid,
  List,
  Terminal,
} from 'lucide-react';
import React, { useEffect, useMemo, useState } from 'react';

import { DEFAULT_BINDINGS } from '@/hooks/defaultKeybindings';
import { Binding, formatKeyEvent, normalizeKeyCombo } from '@/hooks/keybindingUtils';
import { useKeyBindings, formatKeyComboForDisplay } from '@/hooks/useKeyBindings';

export default function ShortcutKeysTab() {
  const { bindings, updateBindings } = useKeyBindings();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewCombo, setPreviewCombo] = useState<string>('');

  const startCapture = (id: string) => {
    setEditingId(id);
    setError(null);
    setPreviewCombo('');
  };

  const stopCapture = () => {
    setEditingId(null);
    setError(null);
    setPreviewCombo('');
  };

  useEffect(() => {
    if (!editingId) return;

    const isModifierKey = (key: string) =>
      key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift';

    let pendingFirstPart: string | null = null;
    const pendingTimer = { id: null as number | null };

    const clearPending = () => {
      pendingFirstPart = null;
      if (pendingTimer.id) {
        clearTimeout(pendingTimer.id);
        pendingTimer.id = null;
      }
    };

    const handler = (e: KeyboardEvent) => {
      try {
        e.preventDefault();
      } catch (err) {}

      if (e.key === 'Escape') {
        clearPending();
        stopCapture();
        return;
      }

      if (isModifierKey(e.key)) {
        const parts: string[] = [];
        const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
        if (isMac) {
          if (e.metaKey) parts.push('Cmd');
          if (e.ctrlKey) parts.push('Ctrl');
        } else {
          if (e.ctrlKey) parts.push('Ctrl');
          if (e.metaKey) parts.push('Meta');
        }
        if (e.altKey) parts.push('Alt');
        if (e.shiftKey) parts.push('Shift');
        setPreviewCombo(parts.join('+'));
        return;
      }

      const single = formatKeyEvent(e);
      if (!single) return;

      if (pendingFirstPart) {
        const full = `${pendingFirstPart} ${single}`;
        const duplicate = bindings.find(b => normalizeKeyCombo(b.combo) === normalizeKeyCombo(full) && b.id !== editingId);
        if (duplicate) {
          setError(`Already assigned to: ${duplicate.name}`);
          clearPending();
          return;
        }
        const newBindings = bindings.map(b => (b.id === editingId ? { ...b, combo: full } : b));
        updateBindings(newBindings);
        clearPending();
        stopCapture();
        return;
      }

      const normalizedSingle = normalizeKeyCombo(single);
      const isPrefix = bindings.some(b => {
        const parts = normalizeKeyCombo(b.combo).split(/\s+/);
        return parts.length === 2 && parts[0] === normalizedSingle;
      });

      if (isPrefix) {
        pendingFirstPart = normalizedSingle;
        setPreviewCombo(pendingFirstPart + ' ...');
        pendingTimer.id = window.setTimeout(() => {
          const singleBinding = bindings.find(b => normalizeKeyCombo(b.combo) === pendingFirstPart && !b.combo.includes(' '));
          if (singleBinding) {
            const newBindings = bindings.map(b => (b.id === editingId ? { ...b, combo: pendingFirstPart! } : b));
            updateBindings(newBindings);
          }
          clearPending();
          stopCapture();
        }, 3500) as unknown as number;
        return;
      }

      const duplicate = bindings.find(b => b.combo === single && b.id !== editingId);
      if (duplicate) {
        setError(`Already assigned to: ${duplicate.name}`);
        return;
      }
      const newBindings = bindings.map(b => (b.id === editingId ? { ...b, combo: single } : b));
      updateBindings(newBindings);
      stopCapture();
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => {
      window.removeEventListener('keydown', handler, { capture: true });
    };
  }, [editingId, bindings, updateBindings]);

  const resetDefaults = async () => {
    if (confirm('すべてのショートカットキーをデフォルトに戻しますか？')) {
      await updateBindings(DEFAULT_BINDINGS);
      setError(null);
    }
  };

  const filteredBindings = useMemo(() => {
    if (!searchQuery) return bindings;
    const lowerQuery = searchQuery.toLowerCase();
    return bindings.filter(
      b =>
        b.name.toLowerCase().includes(lowerQuery) ||
        b.combo.toLowerCase().includes(lowerQuery) ||
        (b.category || '').toLowerCase().includes(lowerQuery)
    );
  }, [bindings, searchQuery]);

  const groupedBindings = useMemo(() => {
    const groups = new Map<string, Binding[]>();
    for (const binding of filteredBindings) {
      const category = binding.category || 'other';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(binding);
    }
    return Array.from(groups.entries()).sort((a, b) => {
        // Custom sort order if needed, or just alphabetical
        const order = ['file', 'search', 'view', 'execution', 'tab', 'git', 'project', 'other'];
        const indexA = order.indexOf(a[0]);
        const indexB = order.indexOf(b[0]);
        if (indexA !== -1 && indexB !== -1) return indexA - indexB;
        if (indexA !== -1) return -1;
        if (indexB !== -1) return 1;
        return a[0].localeCompare(b[0]);
    });
  }, [filteredBindings]);

  const categoryConfig: Record<string, { label: string; icon: React.ReactNode }> = {
    file: { label: 'ファイル', icon: <File size={16} /> },
    search: { label: '検索', icon: <Search size={16} /> },
    view: { label: '表示', icon: <Eye size={16} /> },
    execution: { label: '実行', icon: <Play size={16} /> },
    tab: { label: 'タブ', icon: <Folder size={16} /> }, // Using Folder for tabs as a container metaphor
    git: { label: 'Git', icon: <GitBranch size={16} /> },
    project: { label: 'プロジェクト', icon: <Settings size={16} /> },
    other: { label: 'その他', icon: <Keyboard size={16} /> },
    terminal: { label: 'ターミナル', icon: <Terminal size={16} /> },
  };

  return (
    <div className="flex flex-col h-full bg-background text-foreground text-sm leading-tight">
      {/* Header */}
      <div className="flex-none p-2 border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="flex items-center justify-between gap-3 max-w-7xl mx-auto">
          <div className="flex items-center gap-2">
            <div className="p-1 bg-primary/10 rounded text-primary">
              <Command size={16} />
            </div>
            <h2 className="text-sm font-semibold tracking-tight">ショートカットキー</h2>
          </div>

          <div className="flex-1 max-w-sm relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" size={14} />
            <input
              type="text"
              placeholder="検索 (機能名, キー)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-8 pr-3 py-1 bg-secondary/50 border border-border rounded text-xs focus:outline-none focus:ring-1 focus:ring-primary/40 transition-all"
            />
          </div>

          <button
            className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary rounded transition-colors"
            onClick={resetDefaults}
            title="Reset to defaults"
          >
            <RefreshCw size={12} />
            初期設定に戻す
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 md:p-3">
        <div className="max-w-7xl mx-auto space-y-4">
          {groupedBindings.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <Search size={48} className="mx-auto mb-4 opacity-20" />
              <p>該当するショートカットが見つかりません</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
              {groupedBindings.map(([category, categoryBindings]) => (
                <div 
                  key={category} 
                  className="bg-card border border-border rounded-lg overflow-hidden shadow-sm flex flex-col h-full"
                >
                  <div className="px-3 py-2 bg-muted/30 border-b border-border flex items-center gap-2">
                    <span className="text-muted-foreground">
                      {categoryConfig[category]?.icon || <Keyboard size={14} />}
                    </span>
                    <h3 className="font-medium text-xscapitalize">
                      {categoryConfig[category]?.label || category}
                    </h3>
                    <span className="ml-auto text-xxs text-muted-foreground bg-background/50 px-2 py-0.5 rounded-full text-xs">
                      {categoryBindings.length}
                    </span>
                  </div>
                  
                  <div className="divide-y divide-border/50">
                    {categoryBindings.map(b => (
                      <div 
                        key={b.id} 
                        className="group flex items-center justify-between p-2 hover:bg-muted/50 transition-colors text-sm"
                      >
                        <span className="text-foreground/90 font-medium truncate pr-4" title={b.name}>
                          {b.name}
                        </span>
                        
                        <button
                          onClick={() => startCapture(b.id)}
                          className="flex items-center gap-2 group-hover:bg-background rounded px-1 py-0.5 transition-all border border-transparent group-hover:border-border"
                          title="クリックして編集"
                        >
                          <div className="flex gap-1">
                            {formatKeyComboForDisplay(b.combo).split(' ').map((part, i) => (
                              <kbd 
                                key={i}
                                className="px-1 py-0.5 bg-muted text-muted-foreground rounded border border-border/50 text-[10px] font-mono shadow-sm min-w-[1.1em] text-center"
                              >
                                {part}
                              </kbd>
                            ))}
                          </div>
                          <Edit2 size={12} className="opacity-0 group-hover:opacity-100 text-muted-foreground" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Capture Modal */}
      {editingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-[2px] p-3">
          <div 
            className="bg-card text-card-foreground border border-border rounded-lg shadow-2xl w-full max-w-sm overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="p-4 flex flex-col items-center text-center">
              <div className="w-10 h-10 bg-primary/10 text-primary rounded-full flex items-center justify-center mb-3">
                <Keyboard size={20} />
              </div>

              <h3 className="text-sm font-semibold mb-1">新しいキーを入力</h3>
              <p className="text-xs text-muted-foreground mb-4">
                <span className="font-medium text-foreground">{bindings.find(b => b.id === editingId)?.name}</span> のショートカット
              </p>

              <div className="w-full bg-muted/50 border-2 border-dashed border-border rounded-lg p-4 mb-4 flex items-center justify-center min-h-[72px]">
                {previewCombo ? (
                 <div className="flex gap-2 flex-wrap justify-center">
                   {previewCombo.split(' ').map((part, i) => (
                     <kbd 
                       key={i}
                       className="px-2 py-1 bg-background text-foreground rounded border border-border shadow-sm text-lg font-mono font-semibold"
                     >
                       {part}
                     </kbd>
                   ))}
                 </div>
                ) : (
                  <span className="text-muted-foreground animate-pulse text-xs">キーを押してください...</span>
                )}
              </div>

              {error && (
                <div className="text-destructive text-xs font-medium bg-destructive/10 px-3 py-1.5 rounded-md mb-3">
                  {error}
                </div>
              )}

              <div className="flex w-full gap-2">
                <button
                  className="flex-1 px-3 py-1.5 bg-secondary hover:bg-secondary/80 text-secondary-foreground rounded-md text-xs font-medium transition-colors"
                  onClick={stopCapture}
                >
                  キャンセル
                </button>
              </div>
            </div>
            
            <div className="bg-muted/30 px-4 py-2 text-xs text-muted-foreground border-t border-border flex justify-between">
              <span>Esc でキャンセル</span>
              <span>自動保存されます</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
