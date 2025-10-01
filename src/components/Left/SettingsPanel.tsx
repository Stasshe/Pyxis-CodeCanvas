import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import { downloadWorkspaceZip } from '@/engine/export/exportRepo';
import type { Project } from '@/types';
import { LOCALSTORAGE_KEY } from '@/context/config';

interface SettingsPanelProps {
  currentProject: Project; // 現在のプロジェクト
}
const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentProject }) => {
  const [includeGit, setIncludeGit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const {
    colors,
    setColor,
    themeName,
    setTheme,
    themeList,
    highlightTheme,
    setHighlightTheme,
    highlightThemeList,
  } = useTheme();

  // Gemini APIキー管理
  const [apiKey, setApiKey] = useState(
    () => localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY) || ''
  );
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    localStorage.setItem(LOCALSTORAGE_KEY.GEMINI_API_KEY, value);
  };

  // テーマカラー個別設定 折りたたみ
  const [showColorSettings, setShowColorSettings] = useState(false);
  const handleToggleColorSettings = () => setShowColorSettings(v => !v);

  // デフォルトエディタ設定
  const [defaultEditor, setDefaultEditor] = useState(
    () => localStorage.getItem('pyxis-defaultEditor') || 'monaco'
  );
  const handleDefaultEditorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    setDefaultEditor(e.target.value);
    localStorage.setItem('pyxis-defaultEditor', e.target.value);
  };

  // モナコエディタの折り返し設定
  const [monacoWordWrap, setMonacoWordWrap] = useState(
    () => localStorage.getItem(LOCALSTORAGE_KEY.MONACO_WORD_WRAP) === 'true'
  );
  const handleMonacoWordWrapChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setMonacoWordWrap(e.target.checked);
    localStorage.setItem(LOCALSTORAGE_KEY.MONACO_WORD_WRAP, e.target.checked.toString());
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
    <div
      className="h-full overflow-y-auto"
      style={{ background: colors.background, color: colors.foreground }}
    >
      {/* ワークスペースエクスポート */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: colors.mutedFg }}>
          ワークスペースエクスポート
        </h2>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-opacity-50 py-1 px-2 rounded transition-colors" style={{ color: colors.foreground }}>
            <input
              type="checkbox"
              checked={includeGit}
              onChange={e => setIncludeGit(e.target.checked)}
              className="rounded"
              style={{ accentColor: colors.accentBg }}
            />
            <span>.git ディレクトリも含める</span>
          </label>
          <button
            className="w-full px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            style={{ background: colors.accentBg, color: colors.accentFg }}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting ? 'エクスポート中...' : 'ZIPダウンロード'}
          </button>
        </div>
      </div>

      {/* テーマ設定 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: colors.mutedFg }}>
          テーマ
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              カラーテーマ
            </label>
            <select
              value={themeName}
              onChange={e => setTheme(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            >
              {themeList.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              コードハイライト
            </label>
            <select
              value={highlightTheme}
              onChange={e => setHighlightTheme(e.target.value)}
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            >
              {highlightThemeList.map(name => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <button
              type="button"
              onClick={handleToggleColorSettings}
              className="flex items-center justify-between w-full text-xs py-1.5 px-2 rounded hover:bg-opacity-10 transition-colors"
              style={{ color: colors.foreground, background: showColorSettings ? colors.mutedBg : 'transparent' }}
            >
              <span>カラーカスタマイズ</span>
              <span className="text-[10px]">{showColorSettings ? '▼' : '▶'}</span>
            </button>
            {showColorSettings && (
              <div className="mt-2 p-2 rounded" style={{ background: colors.cardBg }}>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {Object.entries(colors).map(([key, value]) => (
                    <div key={key} className="flex items-center gap-2">
                      <input
                        id={`theme-${key}`}
                        type="color"
                        value={value}
                        onChange={e => setColor(key, e.target.value)}
                        className="w-5 h-5 rounded cursor-pointer border-0"
                      />
                      <label
                        htmlFor={`theme-${key}`}
                        className="text-[10px] cursor-pointer flex-1 truncate"
                        style={{ color: colors.mutedFg }}
                        title={key}
                      >
                        {key}
                      </label>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* エディター設定 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: colors.mutedFg }}>
          エディター
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              デフォルトエディター
            </label>
            <select
              value={defaultEditor}
              onChange={handleDefaultEditorChange}
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            >
              <option value="monaco">Monaco Editor</option>
              <option value="codemirror">CodeMirror</option>
            </select>
          </div>

          <label className="flex items-center gap-2 text-xs cursor-pointer hover:bg-opacity-50 py-1 px-2 rounded transition-colors" style={{ color: colors.foreground }}>
            <input
              type="checkbox"
              checked={monacoWordWrap}
              onChange={handleMonacoWordWrapChange}
              className="rounded"
              style={{ accentColor: colors.accentBg }}
            />
            <span>Monaco: 折り返しを有効化</span>
          </label>
        </div>
      </div>

      {/* API設定 */}
      <div className="px-4 py-3">
        <h2 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: colors.mutedFg }}>
          API
        </h2>
        <div>
          <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
            Gemini APIキー
          </label>
          <input
            type="text"
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder="APIキーを入力"
            className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
            style={{
              background: colors.cardBg,
              color: colors.foreground,
              border: `1px solid ${colors.border}`,
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
