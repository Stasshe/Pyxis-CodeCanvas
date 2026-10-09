import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/context/I18nContext', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      cardBg: '#fff',
      mutedBg: '#eee',
      border: '#ddd',
      sidebarTitleFg: '#111',
      sidebarIconFg: '#111',
    },
  }),
}));

vi.mock('@/hooks/ui/useExtensionPanels', () => ({ useExtensionPanels: () => [] }));

import FileTree from '@/components/Left/FileTree';
import LeftSidebar from '@/components/Left/LeftSidebar';

function findFileTree(node: ReactNode): ReactElement | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findFileTree(child);
      if (match) return match;
    }
    return undefined;
  }
  if (!isValidElement(node)) return undefined;
  if (node.type === FileTree) return node;
  return findFileTree((node.props as { children?: ReactNode }).children);
}

describe('LeftSidebar file tree lifecycle', () => {
  it('remounts file tree state when the workspace root changes', () => {
    const getTreeKey = (rootPath: string) => {
      const sidebar = LeftSidebar({
        activeMenuTab: 'files',
        leftSidebarWidth: 240,
        files: [],
        currentProject: { rootPath, name: 'workspace', updatedAt: new Date(0) },
        onResize: vi.fn(),
      });
      return findFileTree(sidebar)?.key;
    };

    expect(getTreeKey('/workspace/first')).toBe('/workspace/first');
    expect(getTreeKey('/workspace/second')).toBe('/workspace/second');
  });
});
