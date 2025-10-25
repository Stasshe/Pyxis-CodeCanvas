// src/components/Tab/ShortcutKeysTab.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, RefreshCw, X } from 'lucide-react';
import { storageService, STORES } from '@/engine/storage';

type Binding = {
  id: string;
  name: string;
  combo: string; // human readable representation like "Ctrl+S"
};

const KEYBINDINGS_STORAGE_ID = 'user-keybindings';

const DEFAULT_BINDINGS: Binding[] = [
  { id: 'openFile', name: 'Open File', combo: 'Ctrl+O' },
  { id: 'saveFile', name: 'Save File', combo: 'Ctrl+S' },
  { id: 'find', name: 'Find', combo: 'Ctrl+F' },
  { id: 'toggleSidebar', name: 'Toggle Sidebar', combo: 'Ctrl+B' },
  { id: 'runFile', name: 'Run File', combo: 'Ctrl+R' },
];

function formatKeyEvent(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.metaKey) parts.push('Meta');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');

  const key = e.key;
  // ignore modifier-only events
  if (key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift') return '';

  // Normalize some values
  const normalized = key.length === 1 ? key.toUpperCase() : key;
  parts.push(normalized);
  return parts.join('+');
}

export default function ShortcutKeysTab() {
  const [bindings, setBindings] = useState<Binding[]>(DEFAULT_BINDINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [captureValue, setCaptureValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  // IndexedDBからキーバインディングをロード
  useEffect(() => {
    const loadBindings = async () => {
      try {
        const saved = await storageService.get<Binding[]>(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID);
        if (saved && Array.isArray(saved)) {
          setBindings(saved);
        }
      } catch (error) {
        console.error('[ShortcutKeysTab] Failed to load keybindings:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadBindings();
  }, []);

  // IndexedDBに保存
  useEffect(() => {
    if (isLoading) return; // 初回ロード中は保存しない

    const saveBindings = async () => {
      try {
        await storageService.set(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID, bindings);
      } catch (error) {
        console.error('[ShortcutKeysTab] Failed to save keybindings:', error);
      }
    };

    saveBindings();
  }, [bindings, isLoading]);

  const startCapture = (id: string) => {
    setEditingId(id);
    setCaptureValue('');
    setError(null);
  };

  const stopCapture = () => {
    setEditingId(null);
    setCaptureValue('');
    setError(null);
  };

  useEffect(() => {
    if (!editingId) return;

    const handler = (e: KeyboardEvent) => {
      e.preventDefault();
      const formatted = formatKeyEvent(e);
      if (!formatted) return; // modifier only

      // check duplicates
      const duplicate = bindings.find(b => b.combo === formatted && b.id !== editingId);
      if (duplicate) {
        setError(`Already assigned to: ${duplicate.name}`);
        setCaptureValue(formatted);
        return;
      }

      setBindings(prev => prev.map(b => (b.id === editingId ? { ...b, combo: formatted } : b)));
      stopCapture();
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [editingId, bindings]);

  const resetDefaults = async () => {
    setBindings(DEFAULT_BINDINGS);
    setError(null);
    try {
      await storageService.set(STORES.KEYBINDINGS, KEYBINDINGS_STORAGE_ID, DEFAULT_BINDINGS);
    } catch (error) {
      console.error('[ShortcutKeysTab] Failed to reset keybindings:', error);
    }
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

  if (isLoading) {
    return (
      <div className="p-4 h-full overflow-auto flex items-center justify-center">
        <div className="text-muted">読み込み中...</div>
      </div>
    );
  }

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

      <div className="rounded border p-2" style={{ borderColor: 'var(--border)' }}>
        <table className="w-full table-fixed">
          <thead>
            <tr className="text-left text-sm text-muted">
              <th className="w-3/5">アクション</th>
              <th className="w-2/5">ショートカット</th>
            </tr>
          </thead>
          <tbody>
            {bindings.map(b => (
              <tr key={b.id} className="align-top">
                <td className="py-2">{b.name}</td>
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <div className="px-2 py-1 rounded bg-gray-100 text-sm">{b.combo}</div>
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
        <div>編集方法: 編集ボタンを押したあと、割り当てたいキーを実際に押してください（例: Ctrl+S）。</div>
        <div className="mt-2">注意: ブラウザやOSが予約しているキーはキャプチャできない場合があります。</div>
        <div className="mt-2 text-xs">💾 IndexedDB (pyxis-global) に自動保存されます</div>
      </div>
    </div>
  );
}
