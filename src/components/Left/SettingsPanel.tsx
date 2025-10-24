import React, { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { downloadWorkspaceZip } from '@/engine/export/exportRepo';
import type { Project } from '@/types';
import { settingsManager } from '@/engine/helper/settingsManager';
import type { PyxisSettings } from '@/types/settings';
import { LOCALSTORAGE_KEY } from '@/context/config';
import LanguageSelector from '@/components/LanguageSelector';
import { useTranslation } from '@/context/I18nContext';

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

  // 設定状態
  const [settings, setSettings] = useState<PyxisSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // LocalStorageで管理する設定
  const [apiKey, setApiKey] = useState('');
  const [defaultEditor, setDefaultEditor] = useState<'monaco' | 'codemirror'>('monaco');

  // テーマカラー個別設定 折りたたみ
  const [showColorSettings, setShowColorSettings] = useState(false);
  const handleToggleColorSettings = () => setShowColorSettings(v => !v);

  // 設定を読み込み
  useEffect(() => {
    const loadSettings = async () => {
      setIsLoadingSettings(true);
      try {
        const loadedSettings = await settingsManager.loadSettings(currentProject.id);
        setSettings(loadedSettings);

        // Apply any saved custom colors into the theme context so UI reflects them
        try {
          if (loadedSettings.theme && loadedSettings.theme.customColors) {
            Object.entries(loadedSettings.theme.customColors).forEach(([k, v]) => {
              // only apply string values
              if (typeof v === 'string') {
                setColor(k, v);
              }
            });
          }
        } catch (e) {
          console.warn('[SettingsPanel] Failed to apply customColors to theme context:', e);
        }
      } catch (error) {
        console.error('[SettingsPanel] Failed to load settings:', error);
      } finally {
        setIsLoadingSettings(false);
      }
    };

    loadSettings();

    // LocalStorageから設定を読み込み
    const savedApiKey = localStorage.getItem(LOCALSTORAGE_KEY.GEMINI_API_KEY) || '';
    setApiKey(savedApiKey);

    const savedEditor = localStorage.getItem(LOCALSTORAGE_KEY.DEFAULT_EDITOR) || 'monaco';
    if (savedEditor === 'monaco' || savedEditor === 'codemirror') {
      setDefaultEditor(savedEditor);
    }

    // 設定変更リスナーを登録
    const unsubscribe = settingsManager.addListener(currentProject.id, newSettings => {
      setSettings(newSettings);
      // テーマも更新
      setTheme(newSettings.theme.colorTheme);
      setHighlightTheme(newSettings.theme.highlightTheme);
    });

    return () => {
      unsubscribe();
    };
  }, [currentProject.id]);

  // APIキー変更ハンドラ
  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setApiKey(value);
    localStorage.setItem(LOCALSTORAGE_KEY.GEMINI_API_KEY, value);
  };

  // デフォルトエディター変更ハンドラ
  const handleDefaultEditorChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value as 'monaco' | 'codemirror';
    setDefaultEditor(value);
    localStorage.setItem(LOCALSTORAGE_KEY.DEFAULT_EDITOR, value);
  };

  // 設定更新ヘルパー
  const updateSettings = async (updates: Partial<PyxisSettings>) => {
    if (!settings) return;
    try {
      await settingsManager.updateSettings(currentProject.id, updates);
    } catch (error) {
      console.error('[SettingsPanel] Failed to update settings:', error);
      alert('設定の保存に失敗しました');
    }
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

  // ローディング中
  if (isLoadingSettings || !settings) {
    return (
      <div
        className="h-full flex items-center justify-center"
        style={{ background: colors.background, color: colors.mutedFg }}
      >
        <p className="text-xs">設定を読み込み中...</p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto"
      style={{ background: colors.background, color: colors.foreground }}
    >
      {/* ワークスペースエクスポート */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          ワークスペースエクスポート
        </h2>
        <div className="space-y-2">
          <label
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-opacity-50 py-1 px-2 rounded transition-colors"
            style={{ color: colors.foreground }}
          >
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
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          テーマ
        </h2>
        <div className="space-y-3">
          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
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
                <option
                  key={name}
                  value={name}
                >
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
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
                <option
                  key={name}
                  value={name}
                >
                  {name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
              Language / 言語
            </label>
            <LanguageSelector />
          </div>

          <div>
            <button
              type="button"
              onClick={handleToggleColorSettings}
              className="flex items-center justify-between w-full text-xs py-1.5 px-2 rounded hover:bg-opacity-10 transition-colors"
              style={{
                color: colors.foreground,
                background: showColorSettings ? colors.mutedBg : 'transparent',
              }}
            >
              <span>カラーカスタマイズ</span>
              <span className="text-[10px]">
                {showColorSettings ? (
                  <ChevronDown size={14} strokeWidth={2} />
                ) : (
                  <ChevronRight size={14} strokeWidth={2} />
                )}
              </span>
            </button>
            {showColorSettings && (
              <div
                className="mt-2 p-2 rounded"
                style={{ background: colors.cardBg }}
              >
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {Object.entries(colors)
                    // only show simple string color values (hex or rgb/rgba)
                    .filter(([_k, v]) => typeof v === 'string' && (/^#|^rgb\(/).test(v))
                    .map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2">
                        <input
                          id={`theme-${key}`}
                          type="color"
                          value={value as string}
                          onChange={e => {
                            const newVal = e.target.value;
                            // update live theme
                            setColor(key, newVal);

                            // persist into project settings as theme.customColors
                            try {
                              updateSettings({
                                theme: {
                                  ...settings.theme,
                                  customColors: {
                                    ...(settings.theme.customColors || {}),
                                    [key]: newVal,
                                  },
                                },
                              });
                            } catch (err) {
                              console.error('[SettingsPanel] Failed to persist custom color:', err);
                            }
                          }}
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
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          エディター
        </h2>
        <div className="space-y-3">
          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
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
            <p
              className="text-[10px] mt-1"
              style={{ color: colors.mutedFg }}
            >
              LocalStorageに保存されます
            </p>
          </div>

          <label
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-opacity-50 py-1 px-2 rounded transition-colors"
            style={{ color: colors.foreground }}
          >
            <input
              type="checkbox"
              checked={settings.editor.wordWrap}
              onChange={e =>
                updateSettings({
                  editor: { ...settings.editor, wordWrap: e.target.checked },
                })
              }
              className="rounded"
              style={{ accentColor: colors.accentBg }}
            />
            <span>折り返しを有効化</span>
          </label>

          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
              フォントサイズ
            </label>
            <input
              type="number"
              min="8"
              max="32"
              value={settings.editor.fontSize}
              onChange={e =>
                updateSettings({
                  editor: { ...settings.editor, fontSize: parseInt(e.target.value) || 14 },
                })
              }
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            />
          </div>

          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
              タブサイズ
            </label>
            <input
              type="number"
              min="1"
              max="8"
              value={settings.editor.tabSize}
              onChange={e =>
                updateSettings({
                  editor: { ...settings.editor, tabSize: parseInt(e.target.value) || 2 },
                })
              }
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

      {/* API設定 */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          API
        </h2>
        <div>
          <label
            className="block text-xs mb-1.5"
            style={{ color: colors.foreground }}
          >
            Gemini APIキー
          </label>
          <input
            type="password"
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
          <p
            className="text-[10px] mt-1"
            style={{ color: colors.mutedFg }}
          >
            LocalStorageに保存されます
          </p>
        </div>
      </div>

      {/* 検索設定 */}
      <div
        className="px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          検索
        </h2>
        <div className="space-y-3">
          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
              除外パターン
            </label>
            <textarea
              value={settings.search.exclude.join('\n')}
              onChange={e =>
                updateSettings({
                  search: {
                    ...settings.search,
                    exclude: e.target.value.split('\n').filter(Boolean),
                  },
                })
              }
              placeholder="**/node_modules&#10;**/.git"
              rows={5}
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 font-mono"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            />
            <p
              className="text-[10px] mt-1"
              style={{ color: colors.mutedFg }}
            >
              glob パターンを1行ごとに記述
            </p>
          </div>

          <label
            className="flex items-center gap-2 text-xs cursor-pointer hover:bg-opacity-50 py-1 px-2 rounded transition-colors"
            style={{ color: colors.foreground }}
          >
            <input
              type="checkbox"
              checked={settings.search.useIgnoreFiles}
              onChange={e =>
                updateSettings({
                  search: { ...settings.search, useIgnoreFiles: e.target.checked },
                })
              }
              className="rounded"
              style={{ accentColor: colors.accentBg }}
            />
            <span>.gitignoreなどの無視ファイルを使用</span>
          </label>
        </div>
      </div>

      {/* ファイル設定 */}
      <div className="px-4 py-3">
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          ファイル
        </h2>
        <div className="space-y-3">
          <div>
            <label
              className="block text-xs mb-1.5"
              style={{ color: colors.foreground }}
            >
              除外パターン
            </label>
            <textarea
              value={settings.files.exclude.join('\n')}
              onChange={e =>
                updateSettings({
                  files: { ...settings.files, exclude: e.target.value.split('\n').filter(Boolean) },
                })
              }
              placeholder="**/.git&#10;**/.DS_Store"
              rows={3}
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1 font-mono"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            />
            <p
              className="text-[10px] mt-1"
              style={{ color: colors.mutedFg }}
            >
              エクスプローラーで非表示にするファイル/フォルダ
            </p>
          </div>

          {/* autoSave removed from settings */}
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
