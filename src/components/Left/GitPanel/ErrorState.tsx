'use client';
import { useTranslation } from '@/context/I18nContext';
import { X } from 'lucide-react';
import { ThemeColors } from '@/context/ThemeContext';

export default function ErrorState({
  message,
  onRetry,
  colors,
}: {
  message: string | null;
  onRetry: () => void;
  colors: ThemeColors;
}) {
  const { t } = useTranslation();
  return (
    <div style={{ padding: '1rem', textAlign: 'center', color: colors.red }}>
      <X
        style={{
          width: '2rem',
          height: '2rem',
          display: 'block',
          margin: '0 auto 0.5rem',
          color: colors.red,
        }}
      />
      <p style={{ fontSize: '0.875rem', marginBottom: '0.5rem' }}>{t('git.errorOccurred')}</p>
      <p style={{ fontSize: '0.75rem', color: colors.mutedFg }}>{message}</p>
      <button
        onClick={onRetry}
        style={{
          marginTop: '0.5rem',
          padding: '0.5rem 1rem',
          fontSize: '0.75rem',
          background: colors.mutedBg,
          color: colors.foreground,
          borderRadius: '0.375rem',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        {t('action.retry')}
      </button>
    </div>
  );
}
