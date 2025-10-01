// Ask/Edit モード切り替えコンポーネント

'use client';

import React from 'react';
import { useTheme } from '@/context/ThemeContext';
import { MessageCircle, FileEdit } from 'lucide-react';

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

  return (
    <div className="flex gap-1 p-1 rounded-lg" style={{ background: colors.mutedBg }}>
      {modes.map(({ value, label, icon: Icon, description }) => (
        <button
          key={value}
          onClick={() => !disabled && onChange(value)}
          disabled={disabled}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-md transition-all ${
            mode === value ? 'shadow-sm' : 'hover:bg-opacity-50'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          style={{
            background: mode === value ? colors.accent : 'transparent',
            color: mode === value ? colors.accentFg : colors.mutedFg,
          }}
          title={description}
        >
          <Icon size={16} />
          <span className="font-medium text-sm">{label}</span>
          {mode === value && (
            <span
              className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ background: colors.accentFg }}
            />
          )}
        </button>
      ))}
    </div>
  );
}
