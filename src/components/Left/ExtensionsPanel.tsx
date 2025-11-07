/**
 * Extensions Panel
 * 拡張機能の管理UI
 */

import { useState, useEffect, useRef } from 'react';
import {
  Download,
  Trash2,
  Power,
  PowerOff,
  Loader,
  RotateCw,
  Package,
  CheckCircle2,
  Search,
  ChevronDown,
  ChevronRight,
  Upload,
} from 'lucide-react';
import { useTheme } from '@/context/ThemeContext';
import { extensionManager } from '@/engine/extensions/extensionManager';
import { fetchAllManifests } from '@/engine/extensions/extensionRegistry';
import type { InstalledExtension, ExtensionManifest } from '@/engine/extensions/types';
import { useTabStore } from '@/stores/tabStore';

interface ExtensionPack {
  id: string;
  name: string;
  description: string;
  extensions: InstalledExtension[];
  type: 'installed';
}

interface AvailablePack {
  id: string;
  name: string;
  description: string;
  extensions: ExtensionManifest[];
  type: 'available';
}

export default function ExtensionsPanel() {
  const { colors } = useTheme();
  const [installed, setInstalled] = useState<InstalledExtension[]>([]);
  const [available, setAvailable] = useState<ExtensionManifest[]>([]);
  const [availableWithRegistry, setAvailableWithRegistry] = useState<Map<string, string>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'installed' | 'available'>('installed');
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPacks, setExpandedPacks] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    loadExtensions();
  }, []);

  const loadExtensions = async () => {
    setLoading(true);
    try {
      const installedExts = await extensionManager.getInstalledExtensions();
      console.log('[ExtensionsPanel] Installed:', installedExts.length);
      setInstalled(installedExts);

      const allManifests = await fetchAllManifests();
      console.log('[ExtensionsPanel] All manifests from registry:', allManifests.length);

      const installedIds = new Set(installedExts.map(ext => ext.manifest.id));
      console.log('[ExtensionsPanel] Installed IDs:', Array.from(installedIds));

      // レジストリからmanifestUrlのマッピングを作成
      const { fetchRegistry } = await import('@/engine/extensions/extensionRegistry');
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
    const manifestUrl = availableWithRegistry.get(manifest.id);

    if (!manifestUrl) {
      console.error('[ExtensionsPanel] No manifest URL found for:', manifest.id);
      alert(`Failed to install ${manifest.name}: Manifest URL not found in registry`);
      return;
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

  // 更新（キャッシュ削除して再インストール）
  const handleUpdate = async (extensionId: string, manifestUrl: string, extensionName: string) => {
    if (!manifestUrl) {
      alert(`Failed to update ${extensionName}: Manifest URL not found in registry`);
      return;
    }
    try {
      // アンインストール
      await extensionManager.uninstallExtension(extensionId);
      // 再インストール
      await extensionManager.installExtension(manifestUrl);
      await loadExtensions();
    } catch (error) {
      console.error('[ExtensionsPanel] Failed to update extension:', error);
      alert(`Failed to update ${extensionName}: ${(error as Error).message}`);
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

  /**
   * 拡張機能の詳細タブを開く
   */
  const openExtensionInfoTab = (manifest: ExtensionManifest, isEnabled: boolean) => {
    const { openTab } = useTabStore.getState();

    openTab(
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
      'transpiler': 'Transpiler',
      'service': 'Service',
      'builtin-module': 'Built-in Module',
      'language-runtime': 'Language Runtime',
      'tool': 'Tool',
      'ui': 'UI',
    };
    return labels[type] || type;
  };

  const getExtensionTypeBadgeColor = (type: string): string => {
    const colorMap: Record<string, string> = {
      'transpiler': colors.blue,
      'service': colors.purple,
      'builtin-module': colors.green,
      'language-runtime': colors.orange,
      'tool': colors.yellow,
      'ui': colors.cyan,
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

  // 拡張機能をpackGroupでグループ化 (Installed)
  const groupInstalledExtensions = (extensions: InstalledExtension[]) => {
    const packMap = new Map<string, { name: string; extensions: InstalledExtension[] }>();
    const others: InstalledExtension[] = [];

    extensions.forEach(ext => {
      if (ext.manifest.packGroup) {
        const existing = packMap.get(ext.manifest.packGroup.id);
        if (existing) {
          existing.extensions.push(ext);
        } else {
          packMap.set(ext.manifest.packGroup.id, {
            name: ext.manifest.packGroup.name,
            extensions: [ext],
          });
        }
      } else {
        others.push(ext);
      }
    });

    const packs: ExtensionPack[] = Array.from(packMap.entries()).map(([groupId, group]) => ({
      id: groupId,
      name: group.name,
      description: `${group.extensions.length} extension${group.extensions.length > 1 ? 's' : ''}`,
      extensions: group.extensions,
      type: 'installed',
    }));

    return { packs, others };
  };

  // 拡張機能をpackGroupでグループ化 (Available)
  const groupAvailableExtensions = (extensions: ExtensionManifest[]) => {
    const packMap = new Map<string, { name: string; extensions: ExtensionManifest[] }>();
    const others: ExtensionManifest[] = [];

    extensions.forEach(ext => {
      if (ext.packGroup) {
        const existing = packMap.get(ext.packGroup.id);
        if (existing) {
          existing.extensions.push(ext);
        } else {
          packMap.set(ext.packGroup.id, {
            name: ext.packGroup.name,
            extensions: [ext],
          });
        }
      } else {
        others.push(ext);
      }
    });

    const packs: AvailablePack[] = Array.from(packMap.entries()).map(([groupId, group]) => ({
      id: `${groupId}-available`,
      name: group.name,
      description: `${group.extensions.length} extension${group.extensions.length > 1 ? 's' : ''}`,
      extensions: group.extensions,
      type: 'available',
    }));

    return { packs, others };
  };

  // 検索フィルター (Installed)
  const filterInstalledExtensions = (extensions: InstalledExtension[]) => {
    if (!searchQuery.trim()) return extensions;

    const query = searchQuery.toLowerCase();
    return extensions.filter(
      ext =>
        ext.manifest.name.toLowerCase().includes(query) ||
        ext.manifest.id.toLowerCase().includes(query) ||
        ext.manifest.description.toLowerCase().includes(query)
    );
  };

  // 検索フィルター (Available)
  const filterAvailableExtensions = (extensions: ExtensionManifest[]) => {
    if (!searchQuery.trim()) return extensions;

    const query = searchQuery.toLowerCase();
    return extensions.filter(
      ext =>
        ext.name.toLowerCase().includes(query) ||
        ext.id.toLowerCase().includes(query) ||
        ext.description.toLowerCase().includes(query)
    );
  };

  // 検索された拡張機能がパックに属している場合の特殊処理 (Installed)
  const processInstalledWithSearch = () => {
    if (!searchQuery.trim()) {
      return groupInstalledExtensions(installed);
    }

    const filtered = filterInstalledExtensions(installed);
    const { packs, others: allOthers } = groupInstalledExtensions(installed);

    const filteredPacks: ExtensionPack[] = [];
    const filteredOthers: InstalledExtension[] = [];
    const packsToExpand: string[] = [];

    filtered.forEach(ext => {
      const pack = packs.find(p => p.extensions.some(e => e.manifest.id === ext.manifest.id));

      if (pack) {
        if (!filteredPacks.find(p => p.id === pack.id)) {
          const packFiltered = pack.extensions.filter(e =>
            filtered.some(f => f.manifest.id === e.manifest.id)
          );
          filteredPacks.push({
            ...pack,
            extensions: packFiltered,
            description: `${packFiltered.length} extension${packFiltered.length > 1 ? 's' : ''}`,
          });
          // 検索時に展開するパックを記録（状態更新はしない）
          packsToExpand.push(pack.id);
        }
      } else {
        filteredOthers.push(ext);
      }
    });

    // 検索時は自動展開（一度だけ実行）
    if (packsToExpand.length > 0) {
      setTimeout(() => {
        setExpandedPacks(prev => {
          const next = new Set(prev);
          packsToExpand.forEach(id => next.add(id));
          return next;
        });
      }, 0);
    }

    return { packs: filteredPacks, others: filteredOthers };
  };

  // 検索された拡張機能がパックに属している場合の特殊処理 (Available)
  const processAvailableWithSearch = () => {
    if (!searchQuery.trim()) {
      return groupAvailableExtensions(available);
    }

    const filtered = filterAvailableExtensions(available);
    const { packs, others: allOthers } = groupAvailableExtensions(available);

    const filteredPacks: AvailablePack[] = [];
    const filteredOthers: ExtensionManifest[] = [];
    const packsToExpand: string[] = [];

    filtered.forEach(ext => {
      const pack = packs.find(p => p.extensions.some(e => e.id === ext.id));

      if (pack) {
        if (!filteredPacks.find(p => p.id === pack.id)) {
          const packFiltered = pack.extensions.filter(e => filtered.some(f => f.id === e.id));
          filteredPacks.push({
            ...pack,
            extensions: packFiltered,
            description: `${packFiltered.length} extension${packFiltered.length > 1 ? 's' : ''}`,
          });
          // 検索時に展開するパックを記録（状態更新はしない）
          packsToExpand.push(pack.id);
        }
      } else {
        filteredOthers.push(ext);
      }
    });

    // 検索時は自動展開（一度だけ実行）
    if (packsToExpand.length > 0) {
      setTimeout(() => {
        setExpandedPacks(prev => {
          const next = new Set(prev);
          packsToExpand.forEach(id => next.add(id));
          return next;
        });
      }, 0);
    }

    return { packs: filteredPacks, others: filteredOthers };
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
        className="p-3 rounded-lg border transition-all hover:shadow-sm"
        style={{
          background: colors.background,
          borderColor: ext.enabled ? colors.primary + '40' : colors.border,
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              {isInPack && searchQuery && packName && (
                <span
                  className="text-xs"
                  style={{ color: colors.mutedFg }}
                >
                  {packName} &gt;
                </span>
              )}
              <h3
                className="text-sm font-semibold truncate cursor-pointer hover:underline"
                style={{ color: colors.foreground }}
                onClick={() => openExtensionInfoTab(ext.manifest, ext.enabled)}
                title="Click to view extension details"
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

        <div
          className="flex flex-wrap gap-2"
          style={{ minWidth: 0, maxWidth: '100%', overflow: 'hidden' }}
        >
          <button
            className="min-w-[90px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
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
            className="min-w-[90px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
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
          <button
            className="min-w-[90px] flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs rounded transition-all hover:opacity-80"
            style={{
              background: colors.blue + '15',
              color: colors.blue,
              border: `1px solid ${colors.blue}30`,
            }}
            onClick={() => handleUpdate(ext.manifest.id, manifestUrl || '', ext.manifest.name)}
            disabled={!manifestUrl}
            title={manifestUrl ? 'Update extension' : 'Manifest URL not found'}
          >
            <Loader size={12} />
            Update
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
                <span
                  className="text-xs"
                  style={{ color: colors.mutedFg }}
                >
                  {packName} &gt;
                </span>
              )}
              <h3
                className="text-sm font-semibold truncate cursor-pointer hover:underline"
                style={{ color: colors.foreground }}
                onClick={() => openExtensionInfoTab(manifest, false)}
                title="Click to view extension details"
              >
                {manifest.name}
              </h3>
            </div>
            <p
              className="text-xs leading-relaxed line-clamp-2"
              style={{ color: colors.mutedFg }}
            >
              {manifest.description}
            </p>
          </div>
        </div>

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
  };

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-full"
        style={{ color: colors.mutedFg }}
      >
        <Loader
          size={32}
          className="animate-spin mb-3"
        />
        <span className="text-sm">Loading extensions...</span>
      </div>
    );
  }

  const { packs: installedPacks, others: installedOthers } = processInstalledWithSearch();
  const { packs: availablePacks, others: availableOthers } = processAvailableWithSearch();

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: colors.sidebarBg }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <div className="flex items-center">
          <Package
            size={18}
            style={{ color: colors.primary }}
          />
          <h2
            className="ml-2 text-sm font-semibold"
            style={{ color: colors.foreground }}
          >
            Extensions
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
              const f = e.target.files && e.target.files[0];
              if (!f) return;
              setLoading(true);
              try {
                await extensionManager.installExtensionFromZip(f);
                await loadExtensions();
              } catch (err) {
                console.error('[ExtensionsPanel] Failed to import ZIP:', err);
                alert(`Failed to import ZIP: ${(err as Error).message || err}`);
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
            title="Reload extensions"
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
            title="Import extension (.zip)"
            disabled={loading}
          >
            <Upload
              size={16}
              style={{ color: colors.mutedFg }}
            />
          </button>
        </div>
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

      {/* 検索バー */}
      <div
        className="p-3 border-b"
        style={{ borderColor: colors.border }}
      >
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-md border"
          style={{
            background: colors.background,
            borderColor: colors.border,
          }}
        >
          <Search
            size={14}
            style={{ color: colors.mutedFg }}
          />
          <input
            type="text"
            placeholder="Search extensions..."
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
                <Package
                  size={48}
                  className="mb-3 opacity-30"
                />
                <p className="text-sm">
                  {searchQuery ? 'No matching extensions found' : 'No extensions installed'}
                </p>
                <p className="text-xs mt-1 opacity-70">
                  {searchQuery
                    ? 'Try a different search term'
                    : 'Browse available extensions to get started'}
                </p>
              </div>
            ) : (
              <>
                {/* パック表示 */}
                {installedPacks.map(pack => (
                  <div
                    key={pack.id}
                    className="space-y-2"
                  >
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
                        <ChevronDown
                          size={16}
                          style={{ color: colors.mutedFg }}
                        />
                      ) : (
                        <ChevronRight
                          size={16}
                          style={{ color: colors.mutedFg }}
                        />
                      )}
                      <Package
                        size={16}
                        style={{ color: colors.primary }}
                      />
                      <div className="flex-1 text-left">
                        <h3
                          className="text-sm font-semibold"
                          style={{ color: colors.foreground }}
                        >
                          {pack.name}
                        </h3>
                        <p
                          className="text-xs"
                          style={{ color: colors.mutedFg }}
                        >
                          {pack.description}
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
                <CheckCircle2
                  size={48}
                  className="mb-3 opacity-30"
                />
                <p className="text-sm">
                  {searchQuery ? 'No matching extensions found' : 'All extensions installed'}
                </p>
                <p className="text-xs mt-1 opacity-70">
                  {searchQuery
                    ? 'Try a different search term'
                    : 'You have all available extensions'}
                </p>
              </div>
            ) : (
              <>
                {/* パック表示 */}
                {availablePacks.map(pack => (
                  <div
                    key={pack.id}
                    className="space-y-2"
                  >
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
                        <ChevronDown
                          size={16}
                          style={{ color: colors.mutedFg }}
                        />
                      ) : (
                        <ChevronRight
                          size={16}
                          style={{ color: colors.mutedFg }}
                        />
                      )}
                      <Package
                        size={16}
                        style={{ color: colors.primary }}
                      />
                      <div className="flex-1 text-left">
                        <h3
                          className="text-sm font-semibold"
                          style={{ color: colors.foreground }}
                        >
                          {pack.name}
                        </h3>
                        <p
                          className="text-xs"
                          style={{ color: colors.mutedFg }}
                        >
                          {pack.description}
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
    </div>
  );
}
