'use client';

import { useTranslation } from '@/context/I18nContext';
import type { FileItem } from '@/types';
import React from 'react';

interface Props {
  prompt: { file: FileItem } | null;
  mdDialogSelected: 0 | 1;
  setMdDialogSelected: (v: 0 | 1) => void;
  actuallyOpenFile: (file: FileItem, preview: boolean) => void;
  setMdPreviewPrompt: (v: null | { file: FileItem }) => void;
  colors: any;
}

export default function MdPreviewDialog({
  prompt,
  mdDialogSelected,
  setMdDialogSelected,
  actuallyOpenFile,
  setMdPreviewPrompt,
  colors,
}: Props) {
  const { t } = useTranslation();
  if (!prompt) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.4)',
        zIndex: 3000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => setMdPreviewPrompt(null)}
    >
      <div
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.border}`,
          borderRadius: '8px',
          padding: '32px 24px',
          minWidth: '320px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '18px',
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          style={{
            fontSize: '16px',
            fontWeight: 'bold',
            marginBottom: '8px',
            color: colors.foreground,
          }}
        >
          {t('operationWindow.mdPreviewPrompt')}
        </div>
        <div style={{ color: colors.mutedFg, fontSize: '13px', marginBottom: '12px' }}>
          {prompt.file.name}
        </div>
        <div style={{ display: 'flex', gap: '16px' }}>
          <button
            style={{
              padding: '8px 18px',
              background: mdDialogSelected === 0 ? colors.primary : colors.background,
              color: mdDialogSelected === 0 ? colors.cardBg : colors.foreground,
              border:
                mdDialogSelected === 0
                  ? `2px solid ${colors.accentBg}`
                  : `1px solid ${colors.border}`,
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: 'pointer',
              outline: mdDialogSelected === 0 ? `2px solid ${colors.primary}` : undefined,
            }}
            tabIndex={0}
            onClick={() => {
              actuallyOpenFile(prompt.file, true);
              setMdPreviewPrompt(null);
            }}
          >
            {t('operationWindow.openInPreview')}
          </button>
          <button
            style={{
              padding: '8px 18px',
              background: mdDialogSelected === 1 ? colors.primary : colors.background,
              color: mdDialogSelected === 1 ? colors.cardBg : colors.foreground,
              border:
                mdDialogSelected === 1
                  ? `2px solid ${colors.accentBg}`
                  : `1px solid ${colors.border}`,
              borderRadius: '4px',
              fontWeight: 'bold',
              cursor: 'pointer',
              outline: mdDialogSelected === 1 ? `2px solid ${colors.primary}` : undefined,
            }}
            tabIndex={0}
            onClick={() => {
              actuallyOpenFile(prompt.file, false);
              setMdPreviewPrompt(null);
            }}
          >
            {t('operationWindow.openInEditor')}
          </button>
        </div>
        <div style={{ fontSize: '12px', color: colors.mutedFg, marginTop: '8px' }}>
          {t('operationWindow.mdPreviewDialogHelp')}
        </div>
      </div>
    </div>
  );
}
