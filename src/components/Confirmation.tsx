import React from 'react';
import { Check, X } from 'lucide-react';
import { useTheme } from '../context/ThemeContext';

export type ConfirmationProps = {
  open: boolean;
  title?: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
};
export const Confirmation: React.FC<ConfirmationProps> = ({
  open,
  title = '確認',
  message = '本当に実行しますか？',
  confirmText = 'OK',
  cancelText = 'キャンセル',
  onConfirm,
  onCancel,
}) => {
  const { colors } = useTheme();
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(4px)' }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          background: colors.cardBg,
          color: colors.foreground,
          border: `1px solid ${colors.border}`,
        }}
        className="rounded-lg shadow-xl p-6 min-w-[320px] max-w-[90vw]"
      >
        {title && (
          <h2
            className="text-lg font-bold mb-2"
            style={{ color: colors.foreground }}
          >
            {title}
          </h2>
        )}
        <div
          className="mb-4"
          style={{ color: colors.mutedFg }}
        >
          {message}
        </div>
        <div className="flex justify-end gap-2">
          <button
            style={{
              background: colors.mutedBg,
              color: colors.foreground,
              border: `1px solid ${colors.border}`,
            }}
            className="flex items-center gap-1 px-4 py-2 rounded transition"
            onClick={onCancel}
            type="button"
          >
            <X size={18} />
            {cancelText}
          </button>
          <button
            style={{
              background: colors.primary,
              color: '#fff',
              fontWeight: 600,
            }}
            className="flex items-center gap-1 px-4 py-2 rounded transition"
            onClick={onConfirm}
            type="button"
          >
            <Check size={18} />
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
