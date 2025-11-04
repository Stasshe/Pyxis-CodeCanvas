// src/engine/tabs/builtins/ExtensionInfoTabType.tsx
import React from 'react';
import { Package, CheckCircle2, XCircle, Calendar, Tag, User } from 'lucide-react';
import { TabTypeDefinition, TabComponentProps, ExtensionInfoTab } from '../types';
import { useTheme } from '@/context/ThemeContext';
import type { ExtensionManifest } from '@/engine/extensions/types';

/**
 * 拡張機能の詳細情報を表示するコンポーネント
 */
const ExtensionInfoTabRenderer: React.FC<TabComponentProps> = ({ tab }) => {
  const { colors } = useTheme();
  const extensionTab = tab as ExtensionInfoTab;
  const { manifest, isEnabled } = extensionTab;

  const getExtensionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      'transpiler': 'Transpiler',
      'service': 'Service',
      'builtin-module': 'Built-in Module',
      'language-runtime': 'Language Runtime',
      'tool': 'Tool',
      'ui': 'UI Extension',
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

  const typeColor = getExtensionTypeBadgeColor(manifest.type);

  return (
    <div
      className="h-full overflow-auto"
      style={{
        background: colors.background,
        color: colors.foreground,
      }}
    >
      <div className="max-w-4xl mx-auto p-8">
        {/* ヘッダー */}
        <div className="mb-8">
          <div className="flex items-start gap-4 mb-4">
            <div
              className="p-4 rounded-lg"
              style={{ background: colors.primary + '20' }}
            >
              <Package
                size={32}
                style={{ color: colors.primary }}
              />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-2">
                <h1 className="text-3xl font-bold">{manifest.name}</h1>
                {isEnabled ? (
                  <span
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium"
                    style={{
                      background: colors.green + '20',
                      color: colors.green,
                    }}
                  >
                    <CheckCircle2 size={14} />
                    Enabled
                  </span>
                ) : (
                  <span
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium"
                    style={{
                      background: colors.mutedBg,
                      color: colors.mutedFg,
                    }}
                  >
                    <XCircle size={14} />
                    Disabled
                  </span>
                )}
              </div>
              <p
                className="text-lg"
                style={{ color: colors.mutedFg }}
              >
                {manifest.description}
              </p>
            </div>
          </div>
        </div>

        {/* 詳細情報 */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
          {/* ID */}
          <div
            className="p-4 rounded-lg border"
            style={{
              background: colors.sidebarBg,
              borderColor: colors.border,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Package
                size={16}
                style={{ color: colors.primary }}
              />
              <span className="text-sm font-semibold">Extension ID</span>
            </div>
            <code
              className="text-sm px-2 py-1 rounded"
              style={{
                background: colors.mutedBg,
                color: colors.foreground,
              }}
            >
              {manifest.id}
            </code>
          </div>

          {/* バージョン */}
          <div
            className="p-4 rounded-lg border"
            style={{
              background: colors.sidebarBg,
              borderColor: colors.border,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Tag
                size={16}
                style={{ color: colors.primary }}
              />
              <span className="text-sm font-semibold">Version</span>
            </div>
            <span className="text-sm font-mono">{manifest.version}</span>
          </div>

          {/* タイプ */}
          <div
            className="p-4 rounded-lg border"
            style={{
              background: colors.sidebarBg,
              borderColor: colors.border,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <Package
                size={16}
                style={{ color: colors.primary }}
              />
              <span className="text-sm font-semibold">Type</span>
            </div>
            <span
              className="text-sm px-3 py-1 rounded font-medium inline-block"
              style={{
                background: typeColor + '20',
                color: typeColor,
              }}
            >
              {getExtensionTypeLabel(manifest.type)}
            </span>
          </div>

          {/* 作者 */}
          <div
            className="p-4 rounded-lg border"
            style={{
              background: colors.sidebarBg,
              borderColor: colors.border,
            }}
          >
            <div className="flex items-center gap-2 mb-2">
              <User
                size={16}
                style={{ color: colors.primary }}
              />
              <span className="text-sm font-semibold">Author</span>
            </div>
            <span className="text-sm">{manifest.author || 'Unknown'}</span>
          </div>
        </div>

        {/* メタデータ */}
        {manifest.metadata && (
          <div
            className="p-4 rounded-lg border mb-8"
            style={{
              background: colors.sidebarBg,
              borderColor: colors.border,
            }}
          >
            <div className="flex items-center gap-2 mb-4">
              <Calendar
                size={16}
                style={{ color: colors.primary }}
              />
              <span className="text-sm font-semibold">Metadata</span>
            </div>

            {manifest.metadata.publishedAt && (
              <div className="mb-3">
                <span
                  className="text-xs"
                  style={{ color: colors.mutedFg }}
                >
                  Published:
                </span>
                <span className="text-sm ml-2">
                  {new Date(manifest.metadata.publishedAt).toLocaleDateString()}
                </span>
              </div>
            )}

            {manifest.metadata.tags && manifest.metadata.tags.length > 0 && (
              <div>
                <span
                  className="text-xs mb-2 block"
                  style={{ color: colors.mutedFg }}
                >
                  Tags:
                </span>
                <div className="flex flex-wrap gap-2">
                  {manifest.metadata.tags.map((tag: string, idx: number) => (
                    <span
                      key={idx}
                      className="text-xs px-2 py-1 rounded"
                      style={{
                        background: colors.primary + '15',
                        color: colors.primary,
                      }}
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Entry Point */}
        <div
          className="p-4 rounded-lg border"
          style={{
            background: colors.sidebarBg,
            borderColor: colors.border,
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Package
              size={16}
              style={{ color: colors.primary }}
            />
            <span className="text-sm font-semibold">Entry Point</span>
          </div>
          <code
            className="text-sm px-2 py-1 rounded"
            style={{
              background: colors.mutedBg,
              color: colors.foreground,
            }}
          >
            {manifest.entry}
          </code>
        </div>
      </div>
    </div>
  );
};

/**
 * 拡張機能詳細タブタイプの定義
 */
export const ExtensionInfoTabType: TabTypeDefinition = {
  kind: 'extension-info',
  displayName: 'Extension Info',
  icon: 'Package',
  canEdit: false,
  canPreview: false,
  component: ExtensionInfoTabRenderer,

  createTab: (file, options): ExtensionInfoTab => {
    const manifest = file.manifest as ExtensionManifest;
    const tabId = `extension-info:${manifest.id}`;

    return {
      id: tabId,
      name: manifest.name,
      kind: 'extension-info',
      path: `extension-info/${manifest.id}`,
      paneId: options?.paneId || '',
      manifest,
      isEnabled: file.isEnabled ?? false,
    };
  },
};
