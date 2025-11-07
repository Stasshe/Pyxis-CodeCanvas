// src/components/Tab/ShortcutKeysTab.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { Edit2, RefreshCw, X } from 'lucide-react';
import { useKeyBindings, formatKeyComboForDisplay } from '@/hooks/useKeyBindings';
import { DEFAULT_BINDINGS } from '@/hooks/defaultKeybindings';
import { Binding } from '@/hooks/keybindingUtils';

export default function ShortcutKeysTab() {
  const { bindings, updateBindings } = useKeyBindings();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  const [previewCombo, setPreviewCombo] = useState<string>('');

  useEffect(() => {
    if (!editingId) return;

    const isModifierKey = (key: string) =>
      key === 'Control' || key === 'Meta' || key === 'Alt' || key === 'Shift';

    const computeCombo = (e: KeyboardEvent) => {
      const parts: string[] = [];
      const isMac =
        typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');
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
      if (isModifierKey(key)) return parts.join('+');

      const normalized = key.length === 1 ? key.toUpperCase() : key;
      parts.push(normalized);
      return parts.join('+');
    };

    const handler = (e: KeyboardEvent) => {
      try {
        e.preventDefault();
      } catch (err) {}

      // Cancel on Escape
      if (e.key === 'Escape') {
        stopCapture();
        return;
      }

      const combo = computeCombo(e);
      // If user is only pressing modifiers, update preview and wait
      if (isModifierKey(e.key)) {
        setPreviewCombo(combo);
        return;
      }

      // Final key (non-modifier) pressed: validate and save
      if (!combo) return;

      const duplicate = bindings.find(b => b.combo === combo && b.id !== editingId);
      if (duplicate) {
        setError(`Already assigned to: ${duplicate.name}`);
        return;
      }

      const newBindings = bindings.map(b => (b.id === editingId ? { ...b, combo } : b));
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
      <div
        className="flex items-center justify-between mb-4"
        style={{
          background: 'hsl(var(--card))',
          color: 'hsl(var(--card-foreground))',
          padding: '0.5rem',
          borderRadius: '0.375rem',
          border: '1px solid hsl(var(--border))',
        }}
      >
        <h2
          className="text-xl font-semibold"
          style={{ margin: 0 }}
        >
          ショートカットキー設定
        </h2>
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
            <div
              style={{
                display: 'inline-block',
                padding: '0.125rem 0.5rem',
                borderRadius: '0.25rem',
                background: 'hsl(var(--secondary))',
                color: 'hsl(var(--secondary-foreground))',
                fontSize: '0.9rem',
                fontWeight: 600,
                marginBottom: '0.5rem',
              }}
            >
              {categoryNames[category] || category}
            </div>
            <div
              className="rounded border p-2"
              style={{ borderColor: 'var(--border)' }}
            >
              <table
                className="w-full table-fixed"
                style={{ borderCollapse: 'separate', borderSpacing: 0 }}
              >
                <thead>
                  <tr
                    style={{
                      background: 'hsl(var(--input))',
                      color: 'hsl(var(--muted-foreground))',
                    }}
                  >
                    <th
                      className="w-3/5"
                      style={{ textAlign: 'left', padding: '0.5rem' }}
                    >
                      アクション
                    </th>
                    <th
                      className="w-2/5"
                      style={{ textAlign: 'left', padding: '0.5rem' }}
                    >
                      ショートカット
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {categoryBindings.map(b => (
                    <tr
                      key={b.id}
                      className="align-top border-t"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <td className="py-2">{b.name}</td>
                      <td className="py-2">
                        <div className="flex items-center gap-2">
                          <div
                            style={{
                              background: 'hsl(var(--muted))',
                              color: 'hsl(var(--muted-foreground))',
                              padding: '0.125rem 0.5rem',
                              borderRadius: '0.25rem',
                              fontFamily:
                                'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace',
                              fontSize: '0.875rem',
                            }}
                          >
                            {formatKeyComboForDisplay(b.combo)}
                          </div>
                          {editingId === b.id ? (
                            <div className="flex items-center gap-2">
                              <div className="text-sm text-muted">
                                編集中…（ポップアップで入力中）
                              </div>
                              <button
                                className="btn btn-sm"
                                onClick={stopCapture}
                              >
                                <X size={14} /> キャンセル
                              </button>
                            </div>
                          ) : (
                            <button
                              className="btn btn-sm flex items-center gap-2"
                              onClick={() => startCapture(b.id)}
                            >
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

      {/* Capture modal */}
      {editingId && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 60,
          }}
        >
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.45)',
            }}
            onClick={stopCapture}
          />

          <div
            style={{
              position: 'relative',
              background: 'hsl(var(--card))',
              color: 'hsl(var(--card-foreground))',
              border: '1px solid hsl(var(--border))',
              padding: '1rem 1.25rem',
              borderRadius: '0.5rem',
              minWidth: 380,
              maxWidth: '90%',
              boxShadow: '0 10px 30px rgba(0,0,0,0.35)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontWeight: 700 }}>キー割り当てを編集</div>
              <button
                className="btn btn-sm"
                onClick={stopCapture}
                aria-label="キャンセル"
              >
                <X size={14} />
              </button>
            </div>

            <div style={{ marginTop: '0.75rem' }}>
              <div style={{ marginBottom: '0.5rem', color: 'hsl(var(--muted-foreground))' }}>
                編集対象: {bindings.find(b => b.id === editingId)?.name || ''}
              </div>

              <div
                style={{
                  marginTop: '0.5rem',
                  padding: '0.75rem',
                  borderRadius: '0.375rem',
                  background: 'hsl(var(--muted))',
                  color: 'hsl(var(--muted-foreground))',
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Monaco, "Roboto Mono", "Segoe UI Mono", monospace',
                  fontSize: '1.05rem',
                  textAlign: 'center',
                }}
              >
                {previewCombo || 'キーを押してください...'}
              </div>

              <div
                style={{
                  marginTop: '0.75rem',
                  display: 'flex',
                  gap: '0.5rem',
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  className="btn"
                  onClick={stopCapture}
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

      {duplicates.length > 0 && (
        <div className="mt-4 text-sm text-orange-700">
          <strong>重複:</strong>
          <ul>
            {duplicates.map(d => (
              <li key={d.combo}>
                {d.combo} → {d.names.join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        style={{
          marginTop: '1.5rem',
          background: 'hsl(var(--popover))',
          color: 'hsl(var(--popover-foreground))',
          border: '1px solid hsl(var(--border))',
          padding: '0.75rem',
          borderRadius: '0.375rem',
          fontSize: '0.95rem',
          lineHeight: 1.4,
        }}
      >
        <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>編集方法</div>
        <div>編集ボタンを押したあと、割り当てたいキーを実際に押してください。</div>
        <div style={{ marginTop: '0.5rem', color: 'hsl(var(--muted-foreground))' }}>
          💡 Mac: Cmd キー、Windows/Linux: Ctrl キーが自動的に対応されます
        </div>
        <div style={{ marginTop: '0.5rem', color: 'hsl(var(--muted-foreground))' }}>
          注意: ブラウザやOSが予約しているキーはキャプチャできない場合があります。
        </div>
        <div
          style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'hsl(var(--muted-foreground))' }}
        >
          💾 IndexedDB (pyxis-global) に自動保存されます
        </div>
      </div>
    </div>
  );
}
