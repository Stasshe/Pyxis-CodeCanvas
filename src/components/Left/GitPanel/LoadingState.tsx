'use client';
import React from 'react';
import { RefreshCw } from 'lucide-react';

export default function LoadingState({ message, colors }: { message: string; colors: any }) {
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
