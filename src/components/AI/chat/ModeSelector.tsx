// Ask/Edit モード切り替えコンポーネント

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { MessageCircle, FileEdit } from 'lucide-react';

interface ModeSelectorProps {
  mode: 'ask' | 'edit';
  onChange: (mode: 'ask' | 'edit') => void;
  disabled?: boolean;
  small?: boolean;
}

export default function ModeSelector({ mode, onChange, disabled = false, small = false }: ModeSelectorProps) {
  const { colors } = useTheme();

  const modes = [
    { value: 'ask' as const, label: 'Ask', icon: MessageCircle, description: '質問・相談' },
    { value: 'edit' as const, label: 'Edit', icon: FileEdit, description: 'コード編集' },
  ];

  // サイズ調整
  const sizeClass = small
    ? 'gap-0.5 p-0.5 rounded-md'
    : 'gap-1 p-1 rounded-lg';
  const btnPad = small ? 'px-2 py-1' : 'px-4 py-2';
  const iconSize = small ? 13 : 16;
  const fontSize = small ? 'text-xs' : 'text-sm';

  return (
    <div className={`flex ${sizeClass}`} style={{ background: colors.mutedBg }}>
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
            minWidth: small ? 60 : 90,
            minHeight: small ? 28 : 36,
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
