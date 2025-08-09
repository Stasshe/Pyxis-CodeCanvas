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
  const { colors, setColor, themeName, setTheme, themeList, highlightTheme, setHighlightTheme, highlightThemeList } = useTheme();


  // Gemini APIキー管理
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini-api-key') || '');
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    localStorage.setItem('gemini-api-key', value);
  };

  // テーマカラー個別設定 折りたたみ
  const [showColorSettings, setShowColorSettings] = useState(false);
  const handleToggleColorSettings = () => setShowColorSettings(v => !v);

  // デフォルトエディタ設定
  const [defaultEditor, setDefaultEditor] = useState(() => localStorage.getItem('pyxis-defaultEditor') || 'monaco');
  const handleDefaultEditorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDefaultEditor(e.target.value);
    localStorage.setItem('pyxis-defaultEditor', e.target.value);
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
    <div className="p-2 space-y-2" style={{ background: colors.background, color: colors.foreground }}>
      <h2 className="text-base font-semibold">ワークスペースエクスポート</h2>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={includeGit}
          onChange={e => setIncludeGit(e.target.checked)}
          id="includeGit"
        />
        <label htmlFor="includeGit" className="text-sm select-none" style={{ color: colors.foreground }}>.git ディレクトリも含める</label>
      </div>
      <button
        className="px-3 py-1 rounded text-sm disabled:opacity-50"
        style={{ background: colors.accentBg, color: colors.accentFg }}
        onClick={handleExport}
        disabled={isExporting}
      >
        {isExporting ? 'エクスポート中...' : 'ZIPダウンロード'}
      </button>
      <hr className="my-2" style={{ borderColor: colors.mutedBg }} />
      <h2 className="text-base font-semibold">テーマ一括変更</h2>
      <div className="flex items-center gap-2 mb-2">
        <select
          value={themeName}
          onChange={e => setTheme(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
          style={{ background: colors.cardBg, color: colors.foreground, border: `1px solid ${colors.border}` }}
        >
          {themeList.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: colors.mutedFg }}>選択したテーマに一括切替</span>
      </div>

      <h2 className="text-base font-semibold mt-4">コードハイライトテーマ</h2>
      <div className="flex items-center gap-2 mb-2">
        <select
          id="highlightTheme"
          value={highlightTheme}
          onChange={e => setHighlightTheme(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
          style={{ background: colors.cardBg, color: colors.foreground, border: `1px solid ${colors.border}` }}
        >
          {highlightThemeList.map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>
        <span className="text-xs" style={{ color: colors.mutedFg }}>（shiki公式テーマ）</span>
      </div>

      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold mb-0">テーマカラー個別設定</h2>
        <button
          type="button"
          aria-label={showColorSettings ? '縮小' : '展開'}
          onClick={handleToggleColorSettings}
          className="text-xs px-1 py-0 rounded border"
          style={{ background: colors.cardBg, color: colors.foreground, border: `1px solid ${colors.border}` }}
        >
          {showColorSettings ? '▼' : '▶'}
        </button>
      </div>
      {showColorSettings && (
        <div className="grid grid-cols-2 gap-2">
          {Object.entries(colors).map(([key, value]) => (
            <div key={key} className="flex items-center gap-2">
              <label className="text-[10px] w-20" htmlFor={`theme-${key}`} style={{ color: colors.mutedFg }}>{key}</label>
              {/* 全て同じ見た目のpicker */}
              <input
                id={`theme-${key}`}
                type="color"
                value={value}
                onChange={e => setColor(key, e.target.value)}
                className="w-6 h-6 p-0 border rounded"
                style={{ border: `1px solid ${colors.border}` }}
              />
            </div>
          ))}
        </div>
      )}
      <hr className="my-2" style={{ borderColor: colors.mutedBg }} />
      <h2 className="text-base font-semibold">Gemini APIキー</h2>
      <div className="flex items-center gap-2 mb-2">
        <input
          type="text"
          value={apiKey}
          onChange={handleApiKeyChange}
          placeholder="Gemini APIキーを入力"
          className="border rounded px-2 py-1 text-sm w-64"
          style={{ background: colors.cardBg, color: colors.foreground, border: `1px solid ${colors.border}` }}
        />
        <span className="text-xs" style={{ color: colors.mutedFg }}>（保存は即時反映）</span>
      </div>
      <hr className="my-2" style={{ borderColor: colors.mutedBg }} />
      <h2 className="text-base font-semibold">デフォルトコード編集ツール</h2>
      <div className="flex items-center gap-2 mb-2">
        <select
          id="defaultEditor"
          value={defaultEditor}
          onChange={handleDefaultEditorChange}
          className="border rounded px-2 py-1 text-sm"
          style={{ background: colors.cardBg, color: colors.foreground, border: `1px solid ${colors.border}` }}
        >
          <option value="monaco">Monaco Editor</option>
          <option value="codemirror">CodeMirror</option>
        </select>
        <span className="text-xs" style={{ color: colors.mutedFg }}>（ファイルを開く時のデフォルトエディタ）</span>
      </div>
    </div>
  );
};

export default SettingsPanel;
