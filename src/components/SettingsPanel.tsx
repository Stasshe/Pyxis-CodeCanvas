import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { downloadWorkspaceZip } from '@/utils/export/exportRepo';
import type { Project } from '@/types';

interface SettingsPanelProps {
  currentProject: Project; // 現在のプロジェクト
}
const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentProject }) => {
  const [includeGit, setIncludeGit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { colors, setColor, themeName, setTheme, themeList } = useTheme();

  // Gemini APIキー管理
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('geminiApiKey') || '');
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    localStorage.setItem('geminiApiKey', value);
  };

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
      <hr className="my-2 border-muted" />
      <h2 className="text-base font-semibold">テーマ一括変更</h2>
      <div className="flex items-center gap-2 mb-2">
        <select
          value={themeName}
          onChange={e => setTheme(e.target.value)}
          className="border rounded px-2 py-1 text-sm bg-card text-foreground"
        >
          {themeList.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <span className="text-xs">選択したテーマに一括切替</span>
      </div>
      <h2 className="text-base font-semibold">テーマカラー個別設定</h2>
      <div className="grid grid-cols-2 gap-2">
        {Object.entries(colors).map(([key, value]) => (
          <div key={key} className="flex items-center gap-2">
            <label className="text-[10px] w-20" htmlFor={`theme-${key}`}>{key}</label>
            {/* 全て同じ見た目のpicker */}
            <input
              id={`theme-${key}`}
              type="color"
              value={value}
              onChange={e => setColor(key, e.target.value)}
              className="w-6 h-6 p-0 border rounded"
            />
          </div>
        ))}
      </div>
      <hr className="my-2 border-muted" />
      <h2 className="text-base font-semibold">Gemini APIキー</h2>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="Gemini APIキーを入力"
          className="border rounded px-2 py-1 text-sm bg-card text-foreground w-64"
        />
        <span className="text-xs">（保存は即時反映）</span>
      </div>
    </div>
  );
};

export default SettingsPanel;
