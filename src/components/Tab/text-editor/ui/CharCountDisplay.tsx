import CharCountDetails from '../utils/CharCountDetails';

interface CharCountDisplayProps {
  charCount: number;
  selectionCount: number | null;
  showCharCountPopup: boolean;
  onTogglePopup: () => void;
  onClosePopup: () => void;
  content: string;
}

export default function CharCountDisplay({
  charCount,
  selectionCount,
  showCharCountPopup,
  onTogglePopup,
  onClosePopup,
  content,
}: CharCountDisplayProps) {
  return (
    <>
      {/* 文字数カウント表示バー（クリックでポップアップ展開） */}
      <div
        style={{
          position: 'absolute',
          right: 12,
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
        title="クリックで詳細表示"
      >
        {selectionCount !== null
          ? `選択範囲: ${selectionCount}文字（スペース除外）/ 全体: ${charCount}文字（スペース除外）`
          : `全体: ${charCount}文字（スペース除外）`}
      </div>
      {showCharCountPopup && (
        <div
          style={{
            position: 'absolute',
            right: 12,
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
              閉じる
            </button>
          </div>
        </div>
      )}
    </>
  );
}
