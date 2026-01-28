'use client';
import { RefreshCw } from 'lucide-react';
import { ThemeColors } from '@/context/ThemeContext';

export default function LoadingState({ message, colors }: { message: string; colors: ThemeColors }) {
  return (
    <div style={{ padding: '1rem', textAlign: 'center', color: colors.mutedFg }}>
      <RefreshCw
        style={{
          width: '1.5rem',
          height: '1.5rem',
          display: 'block',
          margin: '0 auto 0.5rem',
          animation: 'spin 1s linear infinite',
          color: colors.mutedFg,
        }}
      />
      <p style={{ fontSize: '0.875rem' }}>{message}</p>
    </div>
  );
}
