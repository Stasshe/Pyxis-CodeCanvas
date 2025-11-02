/**
 * Extensions Panel
 * 拡張機能の管理UI
 */

import { useState, useEffect } from 'react';
import { Download, Trash2, Power, PowerOff, Loader, Package, CheckCircle2 } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { extensionManager } from '@/engine/extensions/extensionManager';
import { fetchAllManifests } from '@/engine/extensions/extensionRegistry';
import type { InstalledExtension, ExtensionManifest } from '@/engine/extensions/types';

export default function ExtensionsPanel() {
  const { colors } = useTheme();
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [available, setAvailable] = useState<ExtensionManifest[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');

  useEffect(() => {
    loadExtensions();
  }, []);

  const loadExtensions = async () => {
    setLoading(true);
    try {
      // インストール済み拡張機能を取得
      const installedExts = await extensionManager.getInstalledExtensions();
      console.log('[ExtensionsPanel] Raw installed:', installedExts.length);
      
      // manifestがnullまたはundefinedのものを除外
      const validInstalled = installedExts.filter(ext => ext?.manifest);
      
      console.log('[ExtensionsPanel] Valid installed:', validInstalled.length);
      setInstalled(validInstalled);

      // 利用可能な拡張機能を取得
      const allManifests = await fetchAllManifests();
      console.log('[ExtensionsPanel] All manifests from registry:', allManifests.length);
      
      // インストール済みのIDリスト
      const installedIds = new Set(validInstalled.map(ext => ext.manifest!.id));
      console.log('[ExtensionsPanel] Installed IDs:', Array.from(installedIds));
      
      // インストール済みでない拡張機能をフィルター
      const availableManifests = allManifests.filter(m => {
        const isInstalled = installedIds.has(m.id);
        console.log(`[ExtensionsPanel] Manifest ${m.id}: installed=${isInstalled}`);
        return !isInstalled;
      });
      
      console.log('[ExtensionsPanel] Available after filter:', availableManifests.length);
      setAvailable(availableManifests);
      
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to load extensions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (manifest: ExtensionManifest) => {
    // manifestUrlを構築
    let manifestUrl = '';
    if (manifest.id.startsWith('pyxis.lang.')) {
      const locale = manifest.id.replace('pyxis.lang.', '');
      manifestUrl = `/extensions/lang-packs/${locale}/manifest.json`;
    } else if (manifest.id === 'pyxis.typescript-runtime') {
      manifestUrl = '/extensions/typescript-runtime/manifest.json';
    } else if (manifest.id === 'pyxis.i18n-service') {
      manifestUrl = '/extensions/i18n-service/manifest.json';
    } else {
      const name = manifest.id.replace('pyxis.', '');
      manifestUrl = `/extensions/${name}/manifest.json`;
    }

    try {
      console.log('[ExtensionsPanel] Installing:', manifest.id, 'from', manifestUrl);
      await extensionManager.installExtension(manifestUrl);
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to install extension:', error);
      alert(`Failed to install ${manifest.name}: ${(error as Error).message}`);
    }
  };

  const handleToggle = async (extensionId: string, currentlyEnabled: boolean) => {
    try {
      if (currentlyEnabled) {
        await extensionManager.disableExtension(extensionId);
      } else {
        await extensionManager.enableExtension(extensionId);
      }
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to toggle extension:', error);
      alert(`Failed to toggle: ${(error as Error).message}`);
    }
  };

  const handleUninstall = async (extensionId: string, extensionName: string) => {
    if (confirm(`Uninstall "${extensionName}"?`)) {
      try {
        await extensionManager.uninstallExtension(extensionId);
        await loadExtensions();
      } catch (error) {
        console.error('[ExtensionsPanel] Failed to uninstall extension:', error);
        alert(`Failed to uninstall: ${(error as Error).message}`);
      }
    }
  };

  const getExtensionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      transpiler: 'Transpiler',
      service: 'Service',
      'builtin-module': 'Built-in Module',
      'language-runtime': 'Language Runtime',
      tool: 'Tool',
      ui: 'UI',
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

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ color: colors.mutedFg }}
      >
        <Loader size={32} className="animate-spin mb-3" />
        <span className="text-sm">Loading extensions...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ background: colors.sidebarBg }}>
      {/* ヘッダー */}
      <div
        className="flex items-center px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <Package size={18} style={{ color: colors.primary }} />
        <h2 className="ml-2 text-sm font-semibold" style={{ color: colors.foreground }}>
          Extensions
        </h2>
      </div>

      {/* タブ */}
      <div
        className="flex border-b"
        style={{ borderColor: colors.border }}
      >
        <button
          className="flex-1 px-4 py-2.5 text-sm font-medium transition-all"
          style={{
            color: activeTab === 'installed' ? colors.primary : colors.mutedFg,
            borderBottom: activeTab === 'installed' ? `2px solid ${colors.primary}` : 'none',
            background: activeTab === 'installed' ? colors.mutedBg + '40' : 'transparent',
          }}
          onClick={() => setActiveTab('installed')}
        >
          Installed ({installed.length})
        </button>
        <button
          className="flex-1 px-4 py-2.5 text-sm font-medium transition-all"
          style={{
            color: activeTab === 'available' ? colors.primary : colors.mutedFg,
            borderBottom: activeTab === 'available' ? `2px solid ${colors.primary}` : 'none',
            background: activeTab === 'available' ? colors.mutedBg + '40' : 'transparent',
          }}
          onClick={() => setActiveTab('available')}
        >
          Available ({available.length})
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === 'installed' && (
          <div className="space-y-2">
            {installed.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center"
                style={{ color: colors.mutedFg }}
              >
                <Package size={48} className="mb-3 opacity-30" />
                <p className="text-sm">No extensions installed</p>
                <p className="text-xs mt-1 opacity-70">Browse available extensions to get started</p>
              </div>
            ) : (
              installed.map((ext) => {
                if (!ext.manifest) return null;
                const typeColor = getExtensionTypeBadgeColor(ext.manifest.type);
                
                return (
                  <div
                    key={ext.manifest.id}
                    className="p-3 rounded-lg border transition-all hover:shadow-sm"
                    style={{
                      background: colors.background,
                      borderColor: ext.enabled ? colors.primary + '40' : colors.border,
                    }}
                  >
                    {/* ヘッダー行 */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3
                            className="text-sm font-semibold truncate"
                            style={{ color: colors.foreground }}
                          >
                            {ext.manifest.name}
                          </h3>
                          {ext.enabled && (
                            <CheckCircle2
                              size={14}
                              style={{ color: colors.green }}
                              className="flex-shrink-0"
                            />
                          )}
                        </div>
                        <p
                          className="text-xs leading-relaxed line-clamp-2"
                          style={{ color: colors.mutedFg }}
                        >
                          {ext.manifest.description}
                        </p>
                      </div>
                    </div>

                    {/* メタ情報 */}
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="text-xs px-2 py-0.5 rounded font-medium"
                        style={{
                          background: typeColor + '20',
                          color: typeColor,
                        }}
                      >
                        {getExtensionTypeLabel(ext.manifest.type)}
                      </span>
                      <span
                        className="text-xs"
                        style={{ color: colors.mutedFg }}
                      >
                        v{ext.manifest.version}
                      </span>
                    </div>

                    {/* アクションボタン */}
                    <div className="flex gap-2">
                      <button
                        className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
                        style={{
                          background: ext.enabled ? colors.orange + '15' : colors.primary + '15',
                          color: ext.enabled ? colors.orange : colors.primary,
                          border: `1px solid ${ext.enabled ? colors.orange + '30' : colors.primary + '30'}`,
                        }}
                        onClick={() => handleToggle(ext.manifest!.id, ext.enabled)}
                      >
                        {ext.enabled ? (
                          <>
                            <PowerOff size={12} />
                            Disable
                          </>
                        ) : (
                          <>
                            <Power size={12} />
                            Enable
                          </>
                        )}
                      </button>
                      <button
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
                        style={{
                          background: colors.red + '15',
                          color: colors.red,
                          border: `1px solid ${colors.red}30`,
                        }}
                        onClick={() => handleUninstall(ext.manifest!.id, ext.manifest!.name)}
                      >
                        <Trash2 size={12} />
                        Uninstall
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {activeTab === 'available' && (
          <div className="space-y-2">
            {available.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center py-12 text-center"
                style={{ color: colors.mutedFg }}
              >
                <CheckCircle2 size={48} className="mb-3 opacity-30" />
                <p className="text-sm">All extensions installed</p>
                <p className="text-xs mt-1 opacity-70">You have all available extensions</p>
              </div>
            ) : (
              available.map((manifest) => {
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
                    {/* ヘッダー行 */}
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1 min-w-0">
                        <h3
                          className="text-sm font-semibold mb-1 truncate"
                          style={{ color: colors.foreground }}
                        >
                          {manifest.name}
                        </h3>
                        <p
                          className="text-xs leading-relaxed line-clamp-2"
                          style={{ color: colors.mutedFg }}
                        >
                          {manifest.description}
                        </p>
                      </div>
                    </div>

                    {/* メタ情報 */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded font-medium"
                          style={{
                            background: typeColor + '20',
                            color: typeColor,
                          }}
                        >
                          {getExtensionTypeLabel(manifest.type)}
                        </span>
                        <span
                          className="text-xs"
                          style={{ color: colors.mutedFg }}
                        >
                          v{manifest.version}
                        </span>
                      </div>

                      {/* インストールボタン */}
                      <button
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
                        style={{
                          background: colors.primary + '15',
                          color: colors.primary,
                          border: `1px solid ${colors.primary}30`,
                        }}
                        onClick={() => handleInstall(manifest)}
                      >
                        <Download size={12} />
                        Install
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
}
