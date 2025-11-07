import CharCountDetails from '../utils/CharCountDetails';
import { useTranslation } from '@/context/I18nContext';

interface CharCountDisplayProps {
  charCount: number;
  selectionCount: number | null;
  showCharCountPopup: boolean;
  onTogglePopup: () => void;
  onClosePopup: () => void;
  content: string;
  alignLeft?: boolean;
}

export default function CharCountDisplay({
  charCount,
  selectionCount,
  showCharCountPopup,
  onTogglePopup,
  onClosePopup,
  content,
  alignLeft = false,
}: CharCountDisplayProps) {
  const { t } = useTranslation();
  return (
    <>
      {/* 文字数カウント表示バー（クリックでポップアップ展開） */}
      <div
        style={{
          position: 'absolute',
          right: alignLeft ? undefined : 12,
          left: alignLeft ? 12 : undefined,
          bottom: 8,
          background: 'rgba(30,30,30,0.85)',
          color: '#d4d4d4',
          padding: '2px 10px',
          borderRadius: 6,
          fontSize: 13,
          zIndex: 10,
          cursor: 'pointer',
          userSelect: 'none',
          boxShadow: showCharCountPopup ? '0 2px 8px rgba(0,0,0,0.25)' : undefined,
        }}
        onClick={onTogglePopup}
        title={t('charCountDisplay.clickForDetails')}
      >
        {selectionCount !== null
          ? t('charCountDisplay.selectedAndTotal', { params: { selectionCount, charCount } })
          : t('charCountDisplay.total', { params: { charCount } })}
      </div>
      {showCharCountPopup && (
        <div
          style={{
            position: 'absolute',
            right: alignLeft ? undefined : 12,
            left: alignLeft ? 12 : undefined,
            bottom: 40,
            zIndex: 20,
            background: 'rgba(30,30,30,0.98)',
            borderRadius: 8,
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            padding: '12px 18px',
            minWidth: 180,
            maxWidth: 320,
          }}
          onClick={e => e.stopPropagation()}
        >
          <CharCountDetails content={content} />
          <div style={{ textAlign: 'right', marginTop: 8 }}>
            <button
              style={{
                background: '#444',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                padding: '2px 10px',
                cursor: 'pointer',
                fontSize: 12,
              }}
              onClick={onClosePopup}
            >
              {t('charCountDisplay.close')}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
