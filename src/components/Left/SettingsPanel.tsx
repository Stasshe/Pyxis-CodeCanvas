import { ChevronDown, ChevronRight, Keyboard } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';

import { LOCALSTORAGE_KEY } from '@/constants/config';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { settingsManager } from '@/engine/helper/settingsManager';
import { downloadWorkspaceZip } from '@/engine/in-ex/exportRepo';
import { useTabStore } from '@/stores/tabStore';
import type { Project } from '@/types';
import type { PyxisSettings } from '@/types/settings';

interface SettingsPanelProps {
  currentProject: Project; // 現在のプロジェクト
}
const SettingsPanel: React.FC<SettingsPanelProps> = ({ currentProject }) => {
  const [includeGit, setIncludeGit] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const { t } = useTranslation();
  const openTab = useTabStore(state => state.openTab);
  const { colors, setColor, themeName, setTheme, themeList } = useTheme();

  // 設定状態
  const [settings, setSettings] = useState<PyxisSettings | null>(null);
  const [isLoadingSettings, setIsLoadingSettings] = useState(true);

  // LocalStorageで管理する設定
  const [apiKey, setApiKey] = useState('');
  const [defaultEditor, setDefaultEditor] = useState<'monaco' | 'codemirror'>('monaco');
  // テキストエリア用のローカル状態 (改行入力を妨げないため)
  const [searchExcludeText, setSearchExcludeText] = useState('');
  const [filesExcludeText, setFilesExcludeText] = useState('');

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

        // textarea 用の初期値をセット
        setSearchExcludeText((loadedSettings.search?.exclude || []).join('\n'));
        setFilesExcludeText((loadedSettings.files?.exclude || []).join('\n'));

        // Apply any saved custom colors into the theme context so UI reflects them
        try {
          if (loadedSettings.theme?.customColors) {
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

      // テーマをまず更新（基礎テーマに戻す）
      setTheme(newSettings.theme.colorTheme);
      // highlightTheme removed: no-op

      // settings に保存された customColors があれば、基礎テーマ適用後に上書きして再適用する
      // これにより、保存→通知で基礎テーマに戻される際のフリッカーを防ぐ
      try {
        if (newSettings.theme?.customColors) {
          Object.entries(newSettings.theme.customColors).forEach(([k, v]) => {
            if (typeof v === 'string') {
              setColor(k, v);
            }
          });
        }
      } catch (e) {
        console.warn('[SettingsPanel] Failed to reapply customColors on settings update:', e);
      }

      // textarea 用の値も更新
      setSearchExcludeText((newSettings.search?.exclude || []).join('\n'));
      setFilesExcludeText((newSettings.files?.exclude || []).join('\n'));
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
      alert(`エクスポートに失敗しました: ${e instanceof Error ? e.message : e}`);
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
        <p className="text-xs">{t('settingsPanel.loading')}</p>
      </div>
    );
  }

  return (
    <div
      className="h-full overflow-y-auto select-none"
      style={{ background: colors.background, color: colors.foreground }}
    >
      {/* ワークスペースエクスポート */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          {t('settingsPanel.export.title')}
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
            <span>{t('settingsPanel.export.includeGit')}</span>
          </label>
          <button
            className="w-full px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
            style={{ background: colors.accentBg, color: colors.accentFg }}
            onClick={handleExport}
            disabled={isExporting}
          >
            {isExporting
              ? t('settingsPanel.export.exporting')
              : t('settingsPanel.export.zipDownload')}
          </button>
        </div>
      </div>

      {/* テーマ設定 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          {t('settingsPanel.theme.title')}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.theme.colorTheme')}
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

          {/* highlight theme selection removed (shiki-based) */}

          <div>
            <button
              type="button"
              onClick={async () => {
                // [NEW ARCHITECTURE] Open shortcut keys settings tab using TabContext
                await openTab(
                  { name: 'Shortcut Keys', settingsType: 'shortcuts' },
                  { kind: 'settings' }
                );
              }}
              className="w-full flex items-center gap-2 px-3 py-2 rounded text-xs hover:bg-opacity-10 transition-colors"
              style={{
                color: colors.foreground,
                background: 'transparent',
                border: `1px solid ${colors.border}`,
              }}
            >
              <Keyboard size={14} />
              <span>{t('settingsPanel.shortcutKeys')}</span>
            </button>
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
              <span>{t('settingsPanel.theme.colorCustomize')}</span>
              <span className="text-[10px]">
                {showColorSettings ? (
                  <ChevronDown size={14} strokeWidth={2} />
                ) : (
                  <ChevronRight size={14} strokeWidth={2} />
                )}
              </span>
            </button>
            {showColorSettings && (
              <div className="mt-2 p-2 rounded" style={{ background: colors.cardBg }}>
                <div className="grid grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                  {Object.entries(colors)
                    // only show simple string color values (hex or rgb/rgba)
                    .filter(([_k, v]) => typeof v === 'string' && /^#|^rgb\(/.test(v))
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
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          {t('settingsPanel.editor.title')}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.editor.defaultEditor')}
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
            <p className="text-[10px] mt-1" style={{ color: colors.mutedFg }}>
              {t('settingsPanel.editor.savedToLocalStorage')}
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
            <span>{t('settingsPanel.editor.wordWrap')}</span>
          </label>

          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.editor.fontSize')}
            </label>
            <input
              type="number"
              min="8"
              max="32"
              value={settings.editor.fontSize}
              onChange={e =>
                updateSettings({
                  editor: { ...settings.editor, fontSize: Number.parseInt(e.target.value) || 14 },
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
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.editor.tabSize')}
            </label>
            <input
              type="number"
              min="1"
              max="8"
              value={settings.editor.tabSize}
              onChange={e =>
                updateSettings({
                  editor: { ...settings.editor, tabSize: Number.parseInt(e.target.value) || 2 },
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
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.markdown.mathDelimiter')}
            </label>
            <select
              value={settings.markdown?.math?.delimiter || 'dollar'}
              onChange={e =>
                updateSettings({
                  markdown: {
                    ...settings.markdown,
                    math: {
                      ...(settings.markdown?.math || {}),
                      delimiter: e.target.value as 'dollar' | 'bracket' | 'both',
                    },
                  },
                })
              }
              className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
              style={{
                background: colors.cardBg,
                color: colors.foreground,
                border: `1px solid ${colors.border}`,
              }}
            >
              <option value="dollar">$ ... $ / $$ ... $$</option>
              <option value="bracket">\\(...\\) / \\[...\\]</option>
              <option value="both">Both</option>
            </select>
            <p className="text-[10px] mt-1" style={{ color: colors.mutedFg }}>
              {t('settingsPanel.markdown.mathDelimiterHint')}
            </p>
          </div>
        </div>
      </div>

      {/* API設定 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          {t('settingsPanel.api.title')}
        </h2>
        <div>
          <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
            {t('settingsPanel.api.geminiApiKey')}
          </label>
          <input
            type="password"
            value={apiKey}
            onChange={handleApiKeyChange}
            placeholder={t('settingsPanel.api.apiKeyPlaceholder')}
            className="w-full rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-1"
            style={{
              background: colors.cardBg,
              color: colors.foreground,
              border: `1px solid ${colors.border}`,
            }}
          />
          <p className="text-[10px] mt-1" style={{ color: colors.mutedFg }}>
            {t('settingsPanel.api.savedToLocalStorage')}
          </p>
        </div>
      </div>

      {/* 検索設定 */}
      <div className="px-4 py-3 border-b" style={{ borderColor: colors.border }}>
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          {t('settingsPanel.search.title')}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.search.excludePattern')}
            </label>
            <textarea
              value={searchExcludeText}
              onChange={e => setSearchExcludeText(e.target.value)}
              onBlur={() =>
                updateSettings({
                  search: {
                    ...settings.search,
                    exclude: searchExcludeText.split('\n').filter(Boolean),
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
            <p className="text-[10px] mt-1" style={{ color: colors.mutedFg }}>
              {t('settingsPanel.search.globPatternHint')}
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
            <span>{t('settingsPanel.search.useIgnoreFiles')}</span>
          </label>
        </div>
      </div>

      {/* ファイル設定 */}
      <div className="px-4 py-3">
        <h2
          className="text-xs font-semibold uppercase tracking-wide mb-3"
          style={{ color: colors.mutedFg }}
        >
          {t('settingsPanel.files.title')}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block text-xs mb-1.5" style={{ color: colors.foreground }}>
              {t('settingsPanel.files.excludePattern')}
            </label>
            <textarea
              value={filesExcludeText}
              onChange={e => setFilesExcludeText(e.target.value)}
              onBlur={() =>
                updateSettings({
                  files: {
                    ...settings.files,
                    exclude: filesExcludeText.split('\n').filter(Boolean),
                  },
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
            <p className="text-[10px] mt-1" style={{ color: colors.mutedFg }}>
              {t('settingsPanel.files.excludeHint')}
            </p>
          </div>

          {/* autoSave removed from settings */}
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
