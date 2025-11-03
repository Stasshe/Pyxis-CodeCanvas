'use client';
import React from 'react';
import { getIconForFile } from 'vscode-icons-js';
import {
  FileText,
  Eye,
  Globe,
  Zap,
  GitBranch,
  Settings,
} from 'lucide-react';

interface TabIconProps {
  kind: string;
  filename?: string;
  size?: number;
  color?: string;
}

/**
 * TabIcon: タブのkindとfilenameに応じたアイコンを表示
 * - editor + filename: filenameに応じたアイコン (vscode-icons-js)
 * - preview: Eye アイコン (Markdown プレビュー)
 * - webPreview: Globe アイコン
 * - ai: Zap アイコン (AI機能)
 * - diff: GitBranch アイコン (差分表示)
 * - settings: Settings アイコン
 * - その他: FileText アイコン (デフォルト)
 */
export function TabIcon({
  kind,
  filename,
  size = 14,
  color = 'currentColor',
}: TabIconProps) {
  // editorの場合はfilenameからアイコンを取得
  if (kind === 'editor' && filename) {
    const iconPath = getIconForFile(filename) || getIconForFile('');
    if (iconPath && iconPath.endsWith('.svg')) {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_PATH || '';
      return (
        <img
          src={`${baseUrl}/vscode-icons/${iconPath}`}
          alt={filename}
          style={{
            width: size,
            height: size,
            verticalAlign: 'middle',
          }}
        />
      );
    }
  }

  // kindに応じたアイコンを表示
  switch (kind) {
    case 'preview':
      return <Eye size={size} color={color} />;
    case 'webPreview':
      return <Globe size={size} color={color} />;
    case 'ai':
      return <Zap size={size} color={color} />;
    case 'diff':
      return <GitBranch size={size} color={color} />;
    case 'settings':
      return <Settings size={size} color={color} />;
    default:
      return <FileText size={size} color={color} />;
  }
}
