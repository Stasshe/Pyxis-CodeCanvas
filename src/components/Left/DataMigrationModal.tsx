import { Download, Upload } from 'lucide-react';
import React, { useRef } from 'react';
import { createPortal } from 'react-dom';

import { useTheme } from '@/context/ThemeContext';
import { exportAllData, importAllData, downloadBlob } from '@/engine/export/dataMigration';

interface DataMigrationModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DataMigrationModal: React.FC<DataMigrationModalProps> = ({ isOpen, onClose }) => {
  const { colors } = useTheme();
  const [isExportingData, setIsExportingData] = React.useState(false);
  const [isImportingData, setIsImportingData] = React.useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExportAllData = async () => {
    setIsExportingData(true);
    try {
      const blob = await exportAllData();
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('T')[0];
      const filename = `pyxis-data-export-${timestamp}.zip`;
      downloadBlob(blob, filename);
      alert('全データのエクスポートが完了しました');
    } catch (e) {
      alert('データエクスポートに失敗しました: ' + (e instanceof Error ? e.message : e));
    }
    setIsExportingData(false);
  };

  const handleImportAllData = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const confirmed = confirm(
      '⚠️ 警告: この操作は全ての既存データを削除し、インポートしたデータで置き換えます。\n\n' +
        '以下のデータが完全に削除されます：\n' +
        '- 全てのIndexedDBデータベース\n' +
        '- localStorage（最近のプロジェクトと言語設定を除く）\n' +
        '- sessionStorage\n\n' +
        '続行しますか？'
    );

    if (!confirmed) {
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
      return;
    }

    setIsImportingData(true);
    try {
      await importAllData(file);
      alert(
        'データのインポートが完了しました。\n' + 'ページをリロードして変更を反映してください。'
      );
      // Reload page after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } catch (e) {
      alert('データインポートに失敗しました: ' + (e instanceof Error ? e.message : e));
    } finally {
      setIsImportingData(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0, 0, 0, 0.7)' }}
      onClick={e => {
        // クリックがモーダルの外側の場合のみ閉じる（操作中は閉じない）
        if (e.target === e.currentTarget && !isExportingData && !isImportingData) {
          onClose();
        }
      }}
    >
      <div
        className="rounded-lg shadow-2xl max-w-md w-full mx-4"
        style={{
          background: colors.cardBg,
          border: `1px solid ${colors.border}`,
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* ヘッダー */}
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: colors.border }}
        >
          <h3
            className="text-sm font-semibold"
            style={{ color: colors.foreground }}
          >
            データ移行と復元
          </h3>
          {!isExportingData && !isImportingData && (
            <button
              onClick={onClose}
              className="text-lg hover:opacity-70 transition-opacity"
              style={{ color: colors.mutedFg }}
            >
              ×
            </button>
          )}
        </div>

        {/* コンテンツ */}
        <div className="px-6 py-4 space-y-4">
          <p
            className="text-xs"
            style={{ color: colors.foreground }}
          >
            全てのIndexedDB（プロジェクト、ファイルシステム、設定など）とlocalStorageをZIPファイルとして保存・復元できます。
          </p>

          {/* エクスポートボタン */}
          <div>
            <button
              className="w-full px-4 py-2.5 rounded text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center justify-center gap-2"
              style={{ background: colors.accentBg, color: colors.accentFg }}
              onClick={handleExportAllData}
              disabled={isExportingData || isImportingData}
            >
              <Download size={16} />
              <span>{isExportingData ? 'エクスポート中...' : '全データをエクスポート'}</span>
            </button>
            <p
              className="text-[10px] mt-1.5"
              style={{ color: colors.mutedFg }}
            >
              現在のデータを全てZIPファイルとして保存します
            </p>
          </div>

          {/* 区切り線 */}
          <div
            className="border-t my-4"
            style={{ borderColor: colors.border }}
          />

          {/* インポートボタン */}
          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".zip"
              onChange={handleImportAllData}
              className="hidden"
              id="import-data-file-modal"
            />
            <label
              htmlFor="import-data-file-modal"
              className="w-full px-4 py-2.5 rounded text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity flex items-center justify-center gap-2 cursor-pointer"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `2px solid ${colors.border}`,
                display: 'flex',
                pointerEvents: isImportingData || isExportingData ? 'none' : 'auto',
                opacity: isImportingData || isExportingData ? 0.5 : 1,
              }}
            >
              <Upload size={16} />
              <span>{isImportingData ? 'インポート中...' : 'データをインポート'}</span>
            </label>
            <p
              className="text-[10px] mt-1.5"
              style={{ color: colors.red }}
            >
              ⚠️ インポートすると既存データが全て削除されます
            </p>
          </div>

          {/* 処理中の警告 */}
          {(isExportingData || isImportingData) && (
            <div
              className="p-3 rounded text-xs"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
              }}
            >
              <p className="font-semibold mb-1">処理中...</p>
              <p style={{ color: colors.mutedFg }}>
                {isExportingData &&
                  'データをエクスポートしています。しばらくお待ちください。'}
                {isImportingData &&
                  'データをインポートしています。完了後、ページが自動的にリロードされます。'}
              </p>
            </div>
          )}
        </div>

        {/* フッター */}
        {!isExportingData && !isImportingData && (
          <div
            className="px-6 py-4 border-t flex justify-end"
            style={{ borderColor: colors.border }}
          >
            <button
              onClick={onClose}
              className="px-4 py-2 rounded text-xs font-medium hover:opacity-80 transition-opacity"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
              }}
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  );

  // Use createPortal to render modal at document body level
  return typeof document !== 'undefined' 
    ? createPortal(modalContent, document.body)
    : null;
};

export default DataMigrationModal;
