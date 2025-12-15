// Ask/Edit モード切り替えコンポーネント

'use client';

import { FileEdit, MessageCircle } from 'lucide-react';
import React from 'react';

import { useTheme } from '@/context/ThemeContext';

interface ModeSelectorProps {
  mode: 'ask' | 'edit';
  onChange: (mode: 'ask' | 'edit') => void;
  disabled?: boolean;
}

export default function ModeSelector({ mode, onChange, disabled = false }: ModeSelectorProps) {
  const { colors } = useTheme();

  const modes = [
    { value: 'ask' as const, label: 'Ask', icon: MessageCircle, description: '質問・相談' },
    { value: 'edit' as const, label: 'Edit', icon: FileEdit, description: 'コード編集' },
  ];

  // 固定で small 振る舞いにする
  const sizeClass = 'gap-0.5 p-0.5 rounded-md';
  const btnPad = 'px-2 py-1';
  const iconSize = 13;
  const fontSize = 'text-xs';

  return (
    <div className={`flex ${sizeClass} select-none`} style={{ background: colors.mutedBg }}>
      {modes.map(({ value, label, icon: Icon, description }) => (
        <button
          key={value}
          onClick={() => !disabled && onChange(value)}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-1 ${btnPad} rounded ${
            mode === value ? 'shadow-sm' : 'hover:bg-opacity-50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          style={{
            background: mode === value ? colors.accent : 'transparent',
            color: mode === value ? colors.accentFg : colors.mutedFg,
            minWidth: 56,
            minHeight: 26,
          }}
          title={description}
        >
          <Icon size={iconSize} />
          <span className={`font-medium ${fontSize}`}>{label}</span>
          {mode === value && (
            <span
              className="w-1 h-1 rounded-full animate-pulse"
              style={{ background: colors.accentFg, minWidth: 4, minHeight: 4 }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
