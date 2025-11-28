/**
 * Extension Sidebar Panel Renderer
 * 拡張機能が作成したサイドバーパネルを描画
 */

import React from 'react';

import { useTheme } from '@/context/ThemeContext';
import { sidebarRegistry } from '@/engine/extensions/system-api/SidebarAPI';

interface ExtensionPanelRendererProps {
  extensionId: string;
  panelId: string;
  isActive: boolean;
}

export default function ExtensionPanelRenderer({
  extensionId,
  panelId,
  isActive,
}: ExtensionPanelRendererProps) {
  const { colors } = useTheme();

  // パネル定義を取得
  const panel = sidebarRegistry.getPanel(extensionId, panelId);

  if (!panel) {
    return (
      <div
        className="flex items-center justify-center h-full p-4"
        style={{ background: colors.cardBg, color: colors.foreground }}
      >
        <div className="text-center">
          <p className="text-sm opacity-70">Panel not found</p>
          <p className="text-xs opacity-50 mt-1">
            {extensionId}.{panelId}
          </p>
        </div>
      </div>
    );
  }

  const PanelComponent = panel.definition.component;

  return (
    <React.Suspense
      fallback={
        <div
          className="flex items-center justify-center h-full"
          style={{ background: colors.cardBg, color: colors.foreground }}
        >
          <p className="text-sm">Loading panel...</p>
        </div>
      }
    >
      <PanelComponent
        extensionId={extensionId}
        panelId={panelId}
        isActive={isActive}
        state={panel.state}
      />
    </React.Suspense>
  );
}
