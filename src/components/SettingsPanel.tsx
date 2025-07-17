import React, { useState } from 'react';
import { downloadWorkspaceZip } from '@/utils/export/exportIndexeddb';

interface SettingsPanelProps {
  currentProject?: string;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentProject }) => {
  const [includeGit, setIncludeGit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await downloadWorkspaceZip({ includeGit });
    } catch (e) {
      alert('エクスポートに失敗しました: ' + (e instanceof Error ? e.message : e));
    }
    setIsExporting(false);
  };

  return (
    <div className="p-4">
      <h2 className="text-lg font-bold mb-2">ワークスペースエクスポート</h2>
      <div className="mb-4">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={includeGit}
            onChange={e => setIncludeGit(e.target.checked)}
          />
          <span>.git ディレクトリも含める</span>
        </label>
      </div>
      <button
        className="px-4 py-2 bg-accent text-white rounded disabled:opacity-50"
        onClick={handleExport}
        disabled={isExporting}
      >
        {isExporting ? 'エクスポート中...' : 'ZIPダウンロード'}
      </button>
    </div>
  );
};

export default SettingsPanel;
