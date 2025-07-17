import React, { useState } from 'react';
import { downloadWorkspaceZip } from '@/utils/export/exportRepo';
import type { Project } from '@/types';

interface SettingsPanelProps {
  currentProject: Project; // 現在のプロジェクト
}
const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentProject }) => {
  const [includeGit, setIncludeGit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      await downloadWorkspaceZip({ currentProject, includeGit });
    } catch (e) {
      alert('エクスポートに失敗しました: ' + (e instanceof Error ? e.message : e));
    }
    setIsExporting(false);
  };

  return (
    <div className="p-2 space-y-2">
      <h2 className="text-base font-semibold">ワークスペースエクスポート</h2>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={includeGit}
          onChange={e => setIncludeGit(e.target.checked)}
          id="includeGit"
        />
        <label htmlFor="includeGit" className="text-sm select-none">.git ディレクトリも含める</label>
      </div>
      <button
        className="px-3 py-1 bg-accent text-white rounded text-sm disabled:opacity-50"
        onClick={handleExport}
        disabled={isExporting}
      >
        {isExporting ? 'エクスポート中...' : 'ZIPダウンロード'}
      </button>
      {/* 今後の項目追加用: 例）テーマ設定など */}
    </div>
  );
};

export default SettingsPanel;
