import React, { useState, useMemo } from 'react';
import { useTheme } from '../../context/ThemeContext';

export type OutputType = 'info' | 'error' | 'warn' | 'check';

export interface OutputMessage {
  message: string;
  type?: OutputType;
  context?: string;
  count?: number;
}

interface OutputPanelProps {
  messages: OutputMessage[];
}

// Themeの色を使う
const getTypeColor = (colors: any): Record<OutputType, string> => ({
  info: colors.primary,
  error: colors.red,
  warn: colors.accentFg,
  check: colors.green,
});

export default function OutputPanel({ messages }: OutputPanelProps) {
  const { colors } = useTheme();
  const [contextFilter, setContextFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<OutputType | 'all'>('all');

  const contextList = useMemo(() => {
    const set = new Set<string>();
    messages.forEach(m => {
      if (m.context) set.add(m.context);
    });
    return Array.from(set);
  }, [messages]);

  const typeList: Array<OutputType | 'all'> = ['all', 'info', 'warn', 'error'];
  const typeColor = getTypeColor(colors);

  const filtered = useMemo(() => {
    return messages.filter(msg => {
      const typeMatch = typeFilter === 'all' || (msg.type || 'info') === typeFilter;
      const contextMatch = !contextFilter || msg.context === contextFilter;
      return typeMatch && contextMatch;
    });
  }, [messages, typeFilter, contextFilter]);

  return (
    <div
      className="output-panel h-full overflow-auto"
      style={{
        background: colors.cardBg,
        border: `1px solid ${colors.border}`,
        fontSize: '11px',
        color: colors.editorFg,
        padding: '6px 8px',
        borderRadius: '4px',
        boxShadow: `0 1px 4px 0 ${colors.border}22`,
        minHeight: '48px',
        maxHeight: '100%',
      }}
    >
      {/* フィルターUI */}
      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '6px' }}>
        <label style={{ fontSize: '10px', color: colors.mutedFg }}>
          処理名:
          <select
            style={{
              marginLeft: 4,
              padding: '2px 6px',
              border: `1px solid ${colors.border}`,
              borderRadius: 3,
              fontSize: '10px',
              background: colors.mutedBg,
              color: colors.editorFg,
            }}
            value={contextFilter}
            onChange={e => setContextFilter(e.target.value)}
          >
            <option value="">全て</option>
            {contextList.map(ctx => (
              <option
                key={ctx}
                value={ctx}
              >
                {ctx}
              </option>
            ))}
          </select>
        </label>
        <label style={{ fontSize: '10px', color: colors.mutedFg }}>
          タイプ:
          <select
            style={{
              marginLeft: 4,
              padding: '2px 6px',
              border: `1px solid ${colors.border}`,
              borderRadius: 3,
              fontSize: '10px',
              background: colors.mutedBg,
              color: colors.editorFg,
            }}
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as OutputType | 'all')}
          >
            {typeList.map(type => (
              <option
                key={type}
                value={type}
              >
                {type === 'all' ? '全て' : type}
              </option>
            ))}
          </select>
        </label>
      </div>
      {filtered.length === 0 ? (
        <div style={{ color: colors.mutedFg, fontSize: '10px', padding: '4px 0' }}>
          出力はありません
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {filtered.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                background: colors.background,
                borderRadius: '2px',
                padding: '2px 6px',
                fontSize: '11px',
                color: typeColor[msg.type || 'info'],
                borderLeft: `3px solid ${typeColor[msg.type || 'info']}`,
                marginBottom: '0',
                minHeight: '18px',
              }}
            >
              <span
                style={{
                  fontWeight: 600,
                  marginRight: 4,
                  fontSize: '10px',
                  color: typeColor[msg.type || 'info'],
                }}
              >
                [{msg.type || 'info'}]
              </span>
              {msg.context && (
                <span style={{ marginRight: 4, fontSize: '10px', color: colors.mutedFg }}>
                  ({msg.context})
                </span>
              )}
              <span style={{ fontSize: '11px', color: colors.editorFg, wordBreak: 'break-all' }}>
                {msg.message}
              </span>
              {msg.count && msg.count > 1 && (
                <span style={{ fontSize: '10px', color: colors.mutedFg, marginLeft: '6px' }}>
                  ×{msg.count}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
