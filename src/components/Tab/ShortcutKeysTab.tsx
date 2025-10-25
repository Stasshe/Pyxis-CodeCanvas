// src/components/Tab/ShortcutKeysTab.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, RefreshCw, X } from 'lucide-react';
import { useKeyBindings, DEFAULT_BINDINGS, formatKeyComboForDisplay, type Binding } from '@/hooks/useKeyBindings';

function formatKeyEvent(e: KeyboardEvent) {
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

  const key = e.key;
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return '';

  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);
  return parts.join('+');
}

export default function ShortcutKeysTab() {
  const { bindings, updateBindings } = useKeyBindings();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startCapture = (id: string) => {
    setEditingId(id);
    setError(null);
  };

  const stopCapture = () => {
    setEditingId(null);
    setError(null);
  };

  useEffect(() => {
    if (!editingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const formatted = formatKeyEvent(e);
      if (!formatted) return;

      const duplicate = bindings.find(b => b.combo === formatted && b.id !== editingId);
      if (duplicate) {
        setError(`Already assigned to: ${duplicate.name}`);
        return;
      }

      const newBindings = bindings.map(b => (b.id === editingId ? { ...b, combo: formatted } : b));
      updateBindings(newBindings);
      stopCapture();
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [editingId, bindings, updateBindings]);

  const resetDefaults = async () => {
    await updateBindings(DEFAULT_BINDINGS);
    setError(null);
  };

  const duplicates = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const b of bindings) {
      if (!map.has(b.combo)) map.set(b.combo, []);
      map.get(b.combo)!.push(b.name);
    }
    const d: Array<{ combo: string; names: string[] }> = [];
    for (const [combo, names] of map.entries()) if (names.length > 1) d.push({ combo, names });
    return d;
  }, [bindings]);

  // カテゴリー別にグループ化
  const groupedBindings = useMemo(() => {
    const groups = new Map<string, Binding[]>();
    for (const binding of bindings) {
      const category = binding.category || 'other';
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(binding);
    }
    return Array.from(groups.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  }, [bindings]);

  const categoryNames: Record<string, string> = {
    file: 'ファイル',
    search: '検索',
    view: '表示',
    execution: '実行',
    tab: 'タブ',
    git: 'Git',
    project: 'プロジェクト',
    other: 'その他',
  };

  return (
    <div className="p-4 h-full overflow-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">ショートカットキー設定</h2>
        <div className="flex items-center gap-2">
          <button
            className="btn btn-sm flex items-center gap-2"
            onClick={resetDefaults}
            title="Reset to defaults"
          >
            <RefreshCw size={16} /> デフォルトに戻す
          </button>
        </div>
      </div>

      <div className="space-y-6">
        {groupedBindings.map(([category, categoryBindings]) => (
          <div key={category}>
            <h3 className="text-sm font-semibold mb-2 text-muted-foreground">
              {categoryNames[category] || category}
            </h3>
            <div className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full table-fixed">
                <thead>
                  <tr className="text-left text-sm text-muted">
                    <th className="w-3/5">アクション</th>
                    <th className="w-2/5">ショートカット</th>
                  </tr>
                </thead>
                <tbody>
                  {categoryBindings.map(b => (
                    <tr key={b.id} className="align-top border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-2">{b.name}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-sm font-mono">
                            {formatKeyComboForDisplay(b.combo)}
                          </div>
                          {editingId === b.id ? (
                            <div className="flex items-center gap-2">
                              <div className="text-sm text-muted">キーを押してください...</div>
                              <button className="btn btn-sm" onClick={stopCapture}>
                                <X size={14} /> キャンセル
                              </button>
                            </div>
                          ) : (
                            <button className="btn btn-sm flex items-center gap-2" onClick={() => startCapture(b.id)}>
                              <Edit2 size={14} /> 編集
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="mt-3 text-sm text-red-600">{error}</div>
      )}

      {duplicates.length > 0 && (
        <div className="mt-4 text-sm text-orange-700">
          <strong>重複:</strong>
          <ul>
            {duplicates.map(d => (
              <li key={d.combo}>{d.combo} → {d.names.join(', ')}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-6 text-sm text-muted">
        <div>編集方法: 編集ボタンを押したあと、割り当てたいキーを実際に押してください。</div>
        <div className="mt-2">💡 Mac: Cmd キー、Windows/Linux: Ctrl キーが自動的に対応されます</div>
        <div className="mt-2">注意: ブラウザやOSが予約しているキーはキャプチャできない場合があります。</div>
        <div className="mt-2 text-xs">💾 IndexedDB (pyxis-global) に自動保存されます</div>
      </div>
    </div>
  );
}
