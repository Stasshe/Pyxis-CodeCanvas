/**
 * Extensions Panel
 * 拡張機能の管理UI
 */

import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  Loader,
  Package,
  Power,
  PowerOff,
  RotateCw,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Confirmation } from '@/components/layout/Confirmation';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { extensionManager } from '@/engine/ide/extensions/extensionManager';
import { fetchAllManifests } from '@/engine/ide/extensions/extensionRegistry';
import type { ExtensionManifest, InstalledExtension } from '@/engine/ide/extensions/types';
import { tabActions } from '@/stores/tabState';
import {
  processAvailableExtensions,
  processInstalledExtensions,
} from '../../engine/ide/extensions/extensionPacks';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export default function ExtensionsPanel() {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [available, setAvailable] = useState<ExtensionManifest[]>([]);
  const [availableWithRegistry, setAvailableWithRegistry] = useState<Map<string, string>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uninstallConfirmation, setUninstallConfirmation] = useState<{
    extensionId: string;
    extensionName: string;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadExtensions is a plain function that captures no changing state; run-once on mount
  useEffect(() => {
    loadExtensions();
  }, []);

  const loadExtensions = async () => {
    setLoading(true);
    setOperationError(null);
    try {
      const installedExts = await extensionManager.getInstalledExtensions();
      setInstalled(installedExts);

      const allManifests = await fetchAllManifests();

      const installedIds = new Set(installedExts.map(ext => ext.manifest.id));

      // レジストリからmanifestUrlのマッピングを作成
      const { fetchRegistry } = await import('@/engine/ide/extensions/extensionRegistry');
      const registry = await fetchRegistry();
      const urlMap = new Map<string, string>();
      if (registry) {
        registry.extensions.forEach(entry => {
          urlMap.set(entry.id, entry.manifestUrl);
        });
      }
      setAvailableWithRegistry(urlMap);

      const availableManifests = allManifests.filter(m => {
        const isInstalled = installedIds.has(m.id);
        return !isInstalled;
      });

      setAvailable(availableManifests);
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to load extensions:', error);
      setOperationError(
        t('extensionsPanel.loadFailed', { params: { error: errorMessage(error) } })
      );
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (manifest: ExtensionManifest) => {
    setOperationError(null);
    const manifestUrl = availableWithRegistry.get(manifest.id);

    if (!manifestUrl) {
      setOperationError(
        t('extensionsPanel.installFailed', {
          params: { name: manifest.name, error: t('extensionsPanel.manifestUrlMissing') },
        })
      );
      return;
    }

    try {
      const installed = await extensionManager.installExtension(manifestUrl);
      await loadExtensions();
      if (!installed) {
        throw new Error(t('extensionsPanel.installUnavailable'));
      }
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to install extension:', error);
      setOperationError(
        t('extensionsPanel.installFailed', {
          params: { name: manifest.name, error: errorMessage(error) },
        })
      );
    }
  };

  // 更新（キャッシュ削除して再インストール）
  const handleUpdate = async (extensionId: string, manifestUrl: string, extensionName: string) => {
    setOperationError(null);
    if (!manifestUrl) {
      setOperationError(
        t('extensionsPanel.updateFailed', {
          params: { name: extensionName, error: t('extensionsPanel.manifestUrlMissing') },
        })
      );
      return;
    }
    try {
      // Replacement is manager-owned so it can validate the new package before touching the old one.
      const updated = await extensionManager.updateExtension(extensionId, manifestUrl);
      if (!updated) throw new Error(t('extensionsPanel.updateUnavailable'));
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to update extension:', error);
      setOperationError(
        t('extensionsPanel.updateFailed', {
          params: { name: extensionName, error: errorMessage(error) },
        })
      );
    }
  };

  const handleToggle = async (extensionId: string, currentlyEnabled: boolean) => {
    setOperationError(null);
    try {
      const changed = currentlyEnabled
        ? await extensionManager.disableExtension(extensionId)
        : await extensionManager.enableExtension(extensionId);
      if (!changed)
        throw new Error(
          t(
            currentlyEnabled
              ? 'extensionsPanel.disableUnavailable'
              : 'extensionsPanel.enableUnavailable'
          )
        );
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to toggle extension:', error);
      setOperationError(
        t('extensionsPanel.toggleFailed', { params: { error: errorMessage(error) } })
      );
    }
  };

  const handleUninstall = async (extensionId: string, extensionName: string) => {
    setUninstallConfirmation({ extensionId, extensionName });
  };

  const confirmUninstall = async () => {
    if (!uninstallConfirmation) return;

    setOperationError(null);
    try {
      if (!(await extensionManager.uninstallExtension(uninstallConfirmation.extensionId))) {
        throw new Error(t('extensionsPanel.uninstallUnavailable'));
      }
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to uninstall extension:', error);
      setOperationError(
        t('extensionsPanel.uninstallFailed', { params: { error: errorMessage(error) } })
      );
    } finally {
      setUninstallConfirmation(null);
    }
  };

  /**
   * 拡張機能の詳細タブを開く
   */
  const openExtensionInfoTab = async (manifest: ExtensionManifest, isEnabled: boolean) => {
    const { openTab } = tabActions;

    await openTab(
      {
        kind: 'extension-info',
        name: manifest.name,
        path: `extension-info/${manifest.id}`,
        manifest,
        isEnabled,
      },
      {
        kind: 'extension-info',
        makeActive: true,
      }
    );
  };

  const getExtensionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      transpiler: t('extensionsPanel.types.transpiler'),
      service: t('extensionsPanel.types.service'),
      'builtin-module': t('extensionsPanel.types.builtinModule'),
      'language-runtime': t('extensionsPanel.types.languageRuntime'),
      tool: t('extensionsPanel.types.tool'),
      ui: t('extensionsPanel.types.ui'),
    };
    return labels[type] || type;
  };

  const getExtensionTypeBadgeColor = (type: string): string => {
    const colorMap: Record<string, string> = {
      transpiler: colors.blue,
      service: colors.purple,
      'builtin-module': colors.green,
      'language-runtime': colors.orange,
      tool: colors.yellow,
      ui: colors.cyan,
    };
    return colorMap[type] || colors.mutedFg;
  };

  const togglePack = (packId: string) => {
    setExpandedPacks(prev => {
      const next = new Set(prev);
      if (next.has(packId)) {
        next.delete(packId);
      } else {
        next.add(packId);
      }
      return next;
    });
  };

  // レンダリング用コンポーネント
  const renderInstalledExtension = (
    ext: InstalledExtension,
    isInPack = false,
    packName?: string
  ) => {
    if (!ext.manifest) return null;
    const typeColor = getExtensionTypeBadgeColor(ext.manifest.type);

    // レジストリからmanifestUrl取得
    const manifestUrl = availableWithRegistry.get(ext.manifest.id);
    return (
      <div
        key={ext.manifest.id}
        className="p-3 rounded-lg border transition-all hover:shadow-sm select-none"
        style={{
          background: colors.background,
          borderColor: ext.enabled ? `${colors.primary}40` : colors.border,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isInPack && searchQuery && packName && (
                <span className="text-xs" style={{ color: colors.mutedFg }}>
                  {packName} &gt;
                </span>
              )}
              <h3
                className="text-sm font-semibold truncate cursor-pointer hover:underline"
                style={{ color: colors.foreground }}
                onClick={() => openExtensionInfoTab(ext.manifest, ext.enabled)}
                title={t('extensionsPanel.viewDetails')}
              >
                {ext.manifest.name}
              </h3>
              {ext.enabled && (
                <CheckCircle2 size={14} style={{ color: colors.green }} className="flex-shrink-0" />
              )}
            </div>
            <p className="text-xs leading-relaxed line-clamp-2" style={{ color: colors.mutedFg }}>
              {ext.manifest.description}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 mb-2">
          <span
            className="text-xs px-2 py-0.5 rounded font-medium"
            style={{
              background: `${typeColor}20`,
              color: typeColor,
            }}
          >
            {getExtensionTypeLabel(ext.manifest.type)}
          </span>
          <span className="text-xs" style={{ color: colors.mutedFg }}>
            v{ext.manifest.version}
          </span>
        </div>

        <div
          className="flex flex-wrap gap-2"
          style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}
        >
          <button
            className="min-w-[90px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
            style={{
              background: ext.enabled ? `${colors.accent}15` : `${colors.primary}15`,
              color: ext.enabled ? colors.foreground : colors.primary,
              border: `1px solid ${ext.enabled ? `${colors.accent}30` : `${colors.primary}30`}`,
            }}
            onClick={() => handleToggle(ext.manifest?.id, ext.enabled)}
          >
            {ext.enabled ? (
              <>
                <PowerOff size={12} />
                {t('extensionsPanel.disable')}
              </>
            ) : (
              <>
                <Power size={12} />
                {t('extensionsPanel.enable')}
              </>
            )}
          </button>
          <button
            className="min-w-[90px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
            style={{
              background: `${colors.red}15`,
              color: colors.red,
              border: `1px solid ${colors.red}30`,
            }}
            onClick={() => handleUninstall(ext.manifest?.id, ext.manifest?.name)}
          >
            <Trash2 size={12} />
            {t('extensionsPanel.uninstall')}
          </button>
          <button
            className="min-w-[90px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
            style={{
              background: `${colors.primary}15`,
              color: colors.foreground,
              border: `1px solid ${colors.primary}30`,
            }}
            onClick={() => handleUpdate(ext.manifest.id, manifestUrl || '', ext.manifest.name)}
            disabled={!manifestUrl}
            title={
              manifestUrl ? t('extensionsPanel.update') : t('extensionsPanel.manifestUrlMissing')
            }
          >
            <Loader size={12} />
            {t('extensionsPanel.update')}
          </button>
        </div>
      </div>
    );
  };

  const renderAvailableExtension = (
    manifest: ExtensionManifest,
    isInPack = false,
    packName?: string
  ) => {
    const typeColor = getExtensionTypeBadgeColor(manifest.type);

    return (
      <div
        key={manifest.id}
        className="p-3 rounded-lg border transition-all hover:shadow-sm hover:border-opacity-60"
        style={{
          background: colors.background,
          borderColor: colors.border,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isInPack && searchQuery && packName && (
                <span className="text-xs" style={{ color: colors.mutedFg }}>
                  {packName} &gt;
                </span>
              )}
              <h3
                className="text-sm font-semibold truncate cursor-pointer hover:underline"
                style={{ color: colors.foreground }}
                onClick={() => openExtensionInfoTab(manifest, false)}
                title={t('extensionsPanel.viewDetails')}
              >
                {manifest.name}
              </h3>
            </div>
            <p className="text-xs leading-relaxed line-clamp-2" style={{ color: colors.mutedFg }}>
              {manifest.description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-0.5 rounded font-medium"
              style={{
                background: `${typeColor}20`,
                color: typeColor,
              }}
            >
              {getExtensionTypeLabel(manifest.type)}
            </span>
            <span className="text-xs" style={{ color: colors.mutedFg }}>
              v{manifest.version}
            </span>
          </div>

          <button
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
            style={{
              background: `${colors.primary}15`,
              color: colors.primary,
              border: `1px solid ${colors.primary}30`,
            }}
            onClick={() => handleInstall(manifest)}
          >
            <Download size={12} />
            {t('extensionsPanel.install')}
          </button>
        </div>
      </div>
    );
  };

  const installedResults = processInstalledExtensions(installed, searchQuery);
  const availableResults = processAvailableExtensions(available, searchQuery);
  const autoExpandedPackKey = [
    ...installedResults.packsToExpand,
    ...availableResults.packsToExpand,
  ].join('|');
  useEffect(() => {
    const packIds = autoExpandedPackKey ? autoExpandedPackKey.split('|') : [];
    if (packIds.length === 0) return;
    setExpandedPacks(previous => new Set([...previous, ...packIds]));
  }, [autoExpandedPackKey]);
  const { packs: installedPacks, others: installedOthers } = installedResults;
  const { packs: availablePacks, others: availableOthers } = availableResults;

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ color: colors.mutedFg }}
      >
        <Loader size={32} className="animate-spin mb-3" />
        <span className="text-sm">{t('extensionsPanel.loading')}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: colors.sidebarBg }}>
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <div className="flex items-center">
          <Package size={18} style={{ color: colors.primary }} />
          <h2 className="ml-2 text-sm font-semibold" style={{ color: colors.foreground }}>
            {t('extensionsPanel.title')}
          </h2>
        </div>

        {/* Reload / Import (ZIP) buttons (right end) */}
        <div className="flex items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip"
            style={{ display: 'none' }}
            onChange={async e => {
              const f = e.target.files?.[0];
              if (!f) return;
              setLoading(true);
              try {
                if (!(await extensionManager.installExtensionFromZip(f))) {
                  throw new Error(t('extensionsPanel.installUnavailable'));
                }
                await loadExtensions();
              } catch (err) {
                console.error('[ExtensionsPanel] Failed to import ZIP:', err);
                setOperationError(
                  t('extensionsPanel.importFailed', { params: { error: errorMessage(err) } })
                );
              } finally {
                setLoading(false);
                // clear value so same file can be selected again
                if (e.target) (e.target as HTMLInputElement).value = '';
              }
            }}
          />

          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-all hover:opacity-80"
            style={{
              background: colors.background,
              color: colors.mutedFg,
              border: `1px solid ${colors.border}`,
            }}
            onClick={() => loadExtensions()}
            aria-label={t('extensionsPanel.reload')}
            title={t('extensionsPanel.reload')}
            disabled={loading}
          >
            <RotateCw
              size={16}
              className={loading ? 'animate-spin' : ''}
              style={{ color: colors.mutedFg }}
            />
          </button>

          <button
            className="flex items-center gap-2 px-3 py-1.5 rounded text-sm transition-all hover:opacity-80"
            style={{
              background: colors.background,
              color: colors.mutedFg,
              border: `1px solid ${colors.border}`,
            }}
            onClick={() => fileInputRef.current?.click()}
            aria-label={t('extensionsPanel.importZip')}
            title={t('extensionsPanel.importZip')}
            disabled={loading}
          >
            <Upload size={16} style={{ color: colors.mutedFg }} />
          </button>
        </div>
      </div>

      {/* タブ */}
      {operationError && (
        <div
          role="alert"
          className="border-b px-4 py-2 text-sm"
          style={{ color: colors.red, borderColor: colors.border }}
        >
          {operationError}
        </div>
      )}
      <div className="flex border-b" style={{ borderColor: colors.border }}>
        <button
          className="flex-1 px-4 py-2.5 text-sm font-medium transition-all"
          style={{
            color: activeTab === 'installed' ? colors.primary : colors.mutedFg,
            borderBottom: activeTab === 'installed' ? `2px solid ${colors.primary}` : 'none',
            background: activeTab === 'installed' ? `${colors.mutedBg}40` : 'transparent',
          }}
          onClick={() => setActiveTab('installed')}
        >
          {t('extensionsPanel.installed', { params: { count: installed.length } })}
        </button>
        <button
          className="flex-1 px-4 py-2.5 text-sm font-medium transition-all"
          style={{
            color: activeTab === 'available' ? colors.primary : colors.mutedFg,
            borderBottom: activeTab === 'available' ? `2px solid ${colors.primary}` : 'none',
            background: activeTab === 'available' ? `${colors.mutedBg}40` : 'transparent',
          }}
          onClick={() => setActiveTab('available')}
        >
          {t('extensionsPanel.available', { params: { count: available.length } })}
        </button>
      </div>

      {/* 検索バー */}
      <div className="p-3 border-b" style={{ borderColor: colors.border }}>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md border"
          style={{
            background: colors.background,
            borderColor: colors.border,
          }}
        >
          <Search size={14} style={{ color: colors.mutedFg }} />
          <input
            type="text"
            aria-label={t('extensionsPanel.search')}
            placeholder={t('extensionsPanel.search')}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="flex-1 text-sm bg-transparent outline-none"
            style={{ color: colors.foreground }}
          />
        </div>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === 'installed' && (
          <div className="space-y-2">
            {installedPacks.length === 0 && installedOthers.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center"
                style={{ color: colors.mutedFg }}
              >
                <Package size={48} className="mb-3 opacity-30" />
                <p className="text-sm">
                  {searchQuery
                    ? t('extensionsPanel.noMatches')
                    : t('extensionsPanel.noneInstalled')}
                </p>
                <p className="text-xs mt-1 opacity-70">
                  {searchQuery
                    ? t('extensionsPanel.tryDifferentSearch')
                    : t('extensionsPanel.browseAvailable')}
                </p>
              </div>
            ) : (
              <>
                {/* パック表示 */}
                {installedPacks.map(pack => (
                  <div key={pack.id} className="space-y-2">
                    {/* パックヘッダー */}
                    <button
                      className="w-full flex items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-sm"
                      style={{
                        background: colors.background,
                        borderColor: colors.border,
                      }}
                      onClick={() => togglePack(pack.id)}
                    >
                      {expandedPacks.has(pack.id) ? (
                        <ChevronDown size={16} style={{ color: colors.mutedFg }} />
                      ) : (
                        <ChevronRight size={16} style={{ color: colors.mutedFg }} />
                      )}
                      <Package size={16} style={{ color: colors.primary }} />
                      <div className="flex-1 text-left">
                        <h3 className="text-sm font-semibold" style={{ color: colors.foreground }}>
                          {pack.name}
                        </h3>
                        <p className="text-xs" style={{ color: colors.mutedFg }}>
                          {t('extensionsPanel.packCount', {
                            params: { count: pack.extensions.length },
                          })}
                        </p>
                      </div>
                    </button>

                    {/* パック内の拡張機能 */}
                    {expandedPacks.has(pack.id) && (
                      <div className="ml-6 space-y-2">
                        {pack.extensions.map(ext => renderInstalledExtension(ext, true, pack.name))}
                      </div>
                    )}
                  </div>
                ))}

                {/* 通常の拡張機能 */}
                {installedOthers.map(ext => renderInstalledExtension(ext, false))}
              </>
            )}
          </div>
        )}

        {activeTab === 'available' && (
          <div className="space-y-2">
            {availablePacks.length === 0 && availableOthers.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center"
                style={{ color: colors.mutedFg }}
              >
                <CheckCircle2 size={48} className="mb-3 opacity-30" />
                <p className="text-sm">
                  {searchQuery ? t('extensionsPanel.noMatches') : t('extensionsPanel.allInstalled')}
                </p>
                <p className="text-xs mt-1 opacity-70">
                  {searchQuery
                    ? t('extensionsPanel.tryDifferentSearch')
                    : t('extensionsPanel.allAvailableInstalled')}
                </p>
              </div>
            ) : (
              <>
                {/* パック表示 */}
                {availablePacks.map(pack => (
                  <div key={pack.id} className="space-y-2">
                    {/* パックヘッダー */}
                    <button
                      className="w-full flex items-center gap-2 p-3 rounded-lg border transition-all hover:shadow-sm"
                      style={{
                        background: colors.background,
                        borderColor: colors.border,
                      }}
                      onClick={() => togglePack(pack.id)}
                    >
                      {expandedPacks.has(pack.id) ? (
                        <ChevronDown size={16} style={{ color: colors.mutedFg }} />
                      ) : (
                        <ChevronRight size={16} style={{ color: colors.mutedFg }} />
                      )}
                      <Package size={16} style={{ color: colors.primary }} />
                      <div className="flex-1 text-left">
                        <h3 className="text-sm font-semibold" style={{ color: colors.foreground }}>
                          {pack.name}
                        </h3>
                        <p className="text-xs" style={{ color: colors.mutedFg }}>
                          {t('extensionsPanel.packCount', {
                            params: { count: pack.extensions.length },
                          })}
                        </p>
                      </div>
                    </button>

                    {/* パック内の拡張機能 */}
                    {expandedPacks.has(pack.id) && (
                      <div className="ml-6 space-y-2">
                        {pack.extensions.map(manifest =>
                          renderAvailableExtension(manifest, true, pack.name)
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* 通常の拡張機能 */}
                {availableOthers.map(manifest => renderAvailableExtension(manifest, false))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Uninstall Confirmation Dialog */}
      <Confirmation
        open={uninstallConfirmation !== null}
        title={t('extensionsPanel.uninstallTitle')}
        message={t('extensionsPanel.confirmUninstall', {
          params: { name: uninstallConfirmation?.extensionName ?? '' },
        })}
        confirmText={t('extensionsPanel.uninstall')}
        cancelText={t('common.cancel')}
        onConfirm={confirmUninstall}
        onCancel={() => setUninstallConfirmation(null)}
      />
    </div>
  );
}
