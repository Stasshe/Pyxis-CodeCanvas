/**
 * Extensions Panel
 * 拡張機能の管理UI
 */

import { useState, useEffect } from 'react';
import { Download, Trash2, Settings as SettingsIcon, Check, Loader } from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { useTranslation } from '@/context/I18nContext';
import { extensionManager } from '@/engine/extensions/extensionManager';
import { fetchRegistry, fetchAllManifests } from '@/engine/extensions/extensionRegistry';
import type { InstalledExtension, ExtensionManifest, ExtensionRegistry } from '@/engine/extensions/types';

export default function ExtensionsPanel() {
  const { colors } = useTheme();
  const { t } = useTranslation();
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
      
      // manifestがnullのものを除外
      const validInstalled = installedExts.filter(ext => ext.manifest !== null);
      setInstalled(validInstalled);

      // 利用可能な拡張機能を取得
      const allManifests = await fetchAllManifests();
      console.log('[ExtensionsPanel] All manifests:', allManifests);
      
      // インストール済みのIDリスト
      const installedIds = new Set(validInstalled.map(ext => ext.manifest.id));
      console.log('[ExtensionsPanel] Installed IDs:', Array.from(installedIds));
      
      // インストール済みでない拡張機能をフィルター
      const availableManifests = allManifests.filter((m: ExtensionManifest) => !installedIds.has(m.id));
      setAvailable(availableManifests);
      
      console.log('[ExtensionsPanel] Loaded:', {
        installed: validInstalled.length,
        allManifests: allManifests.length,
        available: availableManifests.length,
      });
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to load extensions:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInstall = async (manifestUrl: string) => {
    try {
      await extensionManager.installExtension(manifestUrl);
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to install extension:', error);
      alert(`Failed to install: ${(error as Error).message}`);
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

  const handleUninstall = async (extensionId: string) => {
    if (confirm(`Uninstall ${extensionId}?`)) {
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
    switch (type) {
      case 'transpiler': return 'Transpiler';
      case 'service': return 'Service';
      case 'builtin-module': return 'Built-in Module';
      case 'language-runtime': return 'Language Runtime';
      case 'tool': return 'Tool';
      case 'ui': return 'UI';
      default: return type;
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center justify-center h-full"
        style={{ color: colors.mutedFg }}
      >
        <Loader size={24} className="animate-spin" />
        <span className="ml-2">Loading extensions...</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* タブ */}
      <div
        className="flex border-b"
        style={{ borderColor: colors.border }}
      >
        <button
          className="px-4 py-2 text-sm font-medium transition-colors"
          style={{
            color: activeTab === 'installed' ? colors.primary : colors.mutedFg,
            borderBottom: activeTab === 'installed' ? `2px solid ${colors.primary}` : 'none',
          }}
          onClick={() => setActiveTab('installed')}
        >
          Installed ({installed.length})
        </button>
        <button
          className="px-4 py-2 text-sm font-medium transition-colors"
          style={{
            color: activeTab === 'available' ? colors.primary : colors.mutedFg,
            borderBottom: activeTab === 'available' ? `2px solid ${colors.primary}` : 'none',
          }}
          onClick={() => setActiveTab('available')}
        >
          Available ({available.length})
        </button>
      </div>

      {/* コンテンツ */}
      <div className="flex-1 overflow-auto p-3">
        {activeTab === 'installed' && (
          <div className="space-y-3">
            {installed.length === 0 ? (
              <div
                className="text-center py-8 text-sm"
                style={{ color: colors.mutedFg }}
              >
                No extensions installed
              </div>
            ) : (
              installed.filter(ext => ext && ext.manifest).map((ext) => (
                <div
                  key={ext.manifest.id}
                  className="p-3 rounded border"
                  style={{
                    background: colors.background,
                    borderColor: colors.border,
                  }}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <h3
                          className="text-sm font-semibold"
                          style={{ color: colors.foreground }}
                        >
                          {ext.manifest.name}
                        </h3>
                        {ext.enabled && (
                          <span
                            className="px-2 py-0.5 text-xs rounded"
                            style={{
                              background: colors.green + '20',
                              color: colors.green,
                            }}
                          >
                            <Check size={12} className="inline mr-1" />
                            Enabled
                          </span>
                        )}
                      </div>
                      <p
                        className="text-xs mt-1"
                        style={{ color: colors.mutedFg }}
                      >
                        {ext.manifest.description}
                      </p>
                      <div className="flex items-center gap-2 mt-2">
                        <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{
                            background: colors.mutedBg,
                            color: colors.mutedFg,
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
                    </div>
                    <div className="flex gap-1 ml-2">
                      <button
                        className="p-1.5 rounded hover:bg-opacity-10 transition-colors"
                        style={{
                          color: ext.enabled ? colors.orange : colors.primary,
                        }}
                        onClick={() => handleToggle(ext.manifest.id, ext.enabled)}
                        title={ext.enabled ? 'Disable' : 'Enable'}
                      >
                        <SettingsIcon size={16} />
                      </button>
                      <button
                        className="p-1.5 rounded hover:bg-opacity-10 transition-colors"
                        style={{ color: colors.red }}
                        onClick={() => handleUninstall(ext.manifest.id)}
                        title="Uninstall"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'available' && (
          <div className="space-y-3">
            {available.length === 0 ? (
              <div
                className="text-center py-8 text-sm"
                style={{ color: colors.mutedFg }}
              >
                No available extensions
              </div>
            ) : (
              available.map((manifest) => {
                // manifestUrlを構築: idから推測
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

                return (
                  <div
                    key={manifest.id}
                    className="p-3 rounded border"
                    style={{
                      background: colors.background,
                      borderColor: colors.border,
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h3
                          className="text-sm font-semibold"
                          style={{ color: colors.foreground }}
                        >
                          {manifest.name}
                        </h3>
                        <p
                          className="text-xs mt-1"
                          style={{ color: colors.mutedFg }}
                        >
                          {manifest.description}
                        </p>
                      </div>
                      <button
                        className="p-1.5 rounded hover:bg-opacity-10 transition-colors"
                        style={{ color: colors.primary }}
                        onClick={() => handleInstall(manifestUrl)}
                        title="Install"
                      >
                        <Download size={16} />
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
