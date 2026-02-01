// src/engine/tabs/builtins/ExtensionInfoTabType.tsx
'use client';
import InlineHighlightedCode from '@/components/Tab/InlineHighlightedCode';
import LocalImage from '@/components/Tab/LocalImage';
import { Calendar, CheckCircle2, Package, Tag, User, XCircle } from 'lucide-react';
import type React from 'react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import type { ExtensionInfoTab, TabComponentProps, TabTypeDefinition } from '../types';

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
      transpiler: 'Transpiler',
      service: 'Service',
      'builtin-module': 'Built-in Module',
      'language-runtime': 'Language Runtime',
      tool: 'Tool',
      ui: 'UI Extension',
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

  const typeColor = getExtensionTypeBadgeColor(manifest.type);

  const [isWide, setIsWide] = useState<boolean>(
    typeof window !== 'undefined' ? window.innerWidth >= 720 : false
  );

  useEffect(() => {
    const onResize = () => setIsWide(window.innerWidth >= 720);
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', onResize);
      // initial
      onResize();
    }
    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('resize', onResize);
      }
    };
  }, []);

  return (
    <div
      className="h-full overflow-hidden flex flex-col"
      style={{
        background: colors.background,
        color: colors.foreground,
      }}
    >
      <div className="max-w-6xl mx-auto p-6 w-full h-full flex flex-col">
        {/* ヘッダー */}
        <div className="mb-6 flex-shrink-0">
          <div className="flex items-start gap-4 mb-2">
            <div className="p-3 rounded-lg" style={{ background: `${colors.primary}20` }}>
              <Package size={28} style={{ color: colors.primary }} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-1">
                <h1 className="text-2xl font-bold">{manifest.name}</h1>
                {isEnabled ? (
                  <span
                    className="flex items-center gap-1 px-3 py-1 rounded-full text-sm font-medium"
                    style={{
                      background: `${colors.green}20`,
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
                    Disabled/Uninstalled
                  </span>
                )}
              </div>
              <p className="text-sm" style={{ color: colors.mutedFg }}>
                {manifest.description}
              </p>
            </div>
          </div>
        </div>

        {/* コンテンツ: 左に README (大きめ)、右に manifest 情報 */}
        <div className={`flex ${isWide ? 'flex-row' : 'flex-col'} gap-6 flex-1 min-h-0`}>
          {/* README */}
          <div
            style={isWide ? { width: '66.666%' } : { width: '100%' }}
            className="h-full flex flex-col min-h-0"
          >
            <div
              className="p-4 rounded-lg border h-full flex flex-col min-h-0"
              style={{
                background: colors.sidebarBg,
                borderColor: colors.border,
              }}
            >
              <div className="mb-4">
                <h2 className="text-lg font-semibold">Readme</h2>
                <span className="text-xs" style={{ color: colors.mutedFg }}>
                  {manifest.readme ? 'README.md' : 'No README available'}
                </span>
              </div>

              <div
                className="prose max-w-none flex-1 min-h-0 flex flex-col"
                style={{ color: colors.foreground }}
              >
                {manifest.readme ? (
                  <div className="flex-1 overflow-y-auto pr-2">
                    <ReactMarkdown
                      remarkPlugins={[remarkGfm]}
                      rehypePlugins={[rehypeRaw, rehypeSanitize]}
                      components={{
                        img: ({ node, src, alt, ...props }: any) => (
                          <LocalImage
                            src={typeof src === 'string' ? src : ''}
                            alt={alt || ''}
                            // manifest readmes are not project-scoped, so do not pass projectName/projectId
                            {...props}
                          />
                        ),
                        pre: (props: any) => (
                          <pre
                            {...props}
                            style={{
                              overflowX: 'auto',
                              padding: '0.75rem',
                              background: colors.mutedBg,
                            }}
                          />
                        ),
                        code: ({ node, inline, className, children, ...props }: any) => {
                          const match = /language-(\w+)/.exec(className || '');
                          const lang = match ? match[1] : '';
                          const codeString = String(children).replace(/\n$/, '');
                          if (!inline && lang) {
                            return <InlineHighlightedCode language={lang} value={codeString} />;
                          }
                          return (
                            <code
                              {...props}
                              className={className}
                              style={{
                                whiteSpace: inline ? 'normal' : 'pre',
                                display: inline ? 'inline' : 'block',
                              }}
                            >
                              {codeString}
                            </code>
                          );
                        },
                      }}
                    >
                      {manifest.readme}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <div className="text-sm" style={{ color: colors.mutedFg }}>
                    {manifest.description || 'No README available for this extension.'}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* manifest の詳細 (右カラム) */}
          <div className="md:w-1/3 h-full overflow-y-auto">
            <div
              className="p-4 rounded-lg border mb-4"
              style={{
                background: colors.sidebarBg,
                borderColor: colors.border,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} style={{ color: colors.primary }} />
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

            <div
              className="p-4 rounded-lg border mb-4"
              style={{
                background: colors.sidebarBg,
                borderColor: colors.border,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Tag size={16} style={{ color: colors.primary }} />
                <span className="text-sm font-semibold">Version</span>
              </div>
              <span className="text-sm font-mono">{manifest.version}</span>
            </div>

            <div
              className="p-4 rounded-lg border mb-4"
              style={{
                background: colors.sidebarBg,
                borderColor: colors.border,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} style={{ color: colors.primary }} />
                <span className="text-sm font-semibold">Type</span>
              </div>
              <span
                className="text-sm px-3 py-1 rounded font-medium inline-block"
                style={{
                  background: `${typeColor}20`,
                  color: typeColor,
                }}
              >
                {getExtensionTypeLabel(manifest.type)}
              </span>
            </div>

            <div
              className="p-4 rounded-lg border mb-4"
              style={{
                background: colors.sidebarBg,
                borderColor: colors.border,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <User size={16} style={{ color: colors.primary }} />
                <span className="text-sm font-semibold">Author</span>
              </div>
              <span className="text-sm">{manifest.author || 'Unknown'}</span>
            </div>

            {manifest.metadata && (
              <div
                className="p-4 rounded-lg border mb-4"
                style={{
                  background: colors.sidebarBg,
                  borderColor: colors.border,
                }}
              >
                <div className="flex items-center gap-2 mb-3">
                  <Calendar size={16} style={{ color: colors.primary }} />
                  <span className="text-sm font-semibold">Metadata</span>
                </div>

                {manifest.metadata.publishedAt && (
                  <div className="mb-2">
                    <span className="text-xs" style={{ color: colors.mutedFg }}>
                      Published:
                    </span>
                    <span className="text-sm ml-2">
                      {new Date(manifest.metadata.publishedAt).toLocaleDateString()}
                    </span>
                  </div>
                )}

                {manifest.metadata.tags && manifest.metadata.tags.length > 0 && (
                  <div>
                    <span className="text-xs mb-2 block" style={{ color: colors.mutedFg }}>
                      Tags:
                    </span>
                    <div className="flex flex-wrap gap-2">
                      {manifest.metadata.tags.map((tag: string, idx: number) => (
                        <span
                          key={idx}
                          className="text-xs px-2 py-1 rounded"
                          style={{ background: `${colors.primary}15`, color: colors.primary }}
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div
              className="p-4 rounded-lg border"
              style={{
                background: colors.sidebarBg,
                borderColor: colors.border,
              }}
            >
              <div className="flex items-center gap-2 mb-2">
                <Package size={16} style={{ color: colors.primary }} />
                <span className="text-sm font-semibold">Entry Point</span>
              </div>
              <code
                className="text-sm px-2 py-1 rounded"
                style={{ background: colors.mutedBg, color: colors.foreground }}
              >
                {manifest.entry}
              </code>
            </div>
          </div>
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
  needsSessionRestore: false, // manifest と isEnabled は保持されるので復元不要

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
      isEnabled: Boolean(file.isEnabled),
    };
  },

  // manifest と isEnabled はデフォルトシリアライズで保持される
};
