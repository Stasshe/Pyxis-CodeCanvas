import React, { useRef, useEffect, useState } from 'react';

import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { terminalCommandRegistry } from '@/engine/cmd/terminalRegistry';
import { fileRepository } from '@/engine/core/fileRepository';
import { exportFolderZip } from '@/engine/export/exportFolderZip';
import { exportSingleFile } from '@/engine/export/exportSingleFile';
import { importSingleFile } from '@/engine/import/importSingleFile';
import { useTabStore } from '@/stores/tabStore';
import type { FileItem } from '@/types';
import type { ContextMenuState } from './types';

/**
 * Constructs a file path from a base path and a name.
 * Handles proper path joining with slashes.
 */
function constructPath(basePath: string | undefined, name: string): string {
  if (!basePath) {
    return name.startsWith('/') ? name : '/' + name;
  }
  const normalizedBase = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;
  return `${normalizedBase}/${name}`;
}

interface FileTreeContextMenuProps {
  contextMenu: ContextMenuState;
  setContextMenu: (menu: ContextMenuState | null) => void;
  currentProjectName: string;
  currentProjectId?: string;
  onRefresh?: () => void;
}

export default function FileTreeContextMenu({
  contextMenu,
  setContextMenu,
  currentProjectName,
  currentProjectId,
  onRefresh,
}: FileTreeContextMenuProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = useTabStore();
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [menuHoveredIdx, setMenuHoveredIdx] = useState<number | null>(null);

  // Close on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [setContextMenu]);

  const handlePreview = async (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' && item.name.endsWith('.md')) {
      await openTab(item, { kind: 'preview' });
    }
  };

  const handleWebPreview = async (item: FileItem) => {
    setContextMenu(null);
    if (item.type === 'file' || item.type === 'folder') {
      await openTab(item, { kind: 'webPreview', projectName: currentProjectName });
    }
  };

  const menuItems: Array<{ key: string; label: string }> =
    contextMenu.item == null
      ? [
          { key: 'createFile', label: t('fileTree.menu.createFile') },
          { key: 'createFolder', label: t('fileTree.menu.createFolder') },
          { key: 'importFiles', label: t('fileTree.menu.importFiles') },
          { key: 'importFolder', label: t('fileTree.menu.importFolder') },
        ]
      : ([
          contextMenu.item.type === 'file' ? { key: 'open', label: t('fileTree.menu.open') } : null,
          contextMenu.item.type === 'file' && contextMenu.item.name.endsWith('.md')
            ? { key: 'openPreview', label: t('fileTree.menu.openPreview') }
            : null,
          contextMenu.item.type === 'file'
            ? { key: 'openCodeMirror', label: t('fileTree.menu.openCodeMirror') }
            : null,
          { key: 'download', label: t('fileTree.menu.download') },
          { key: 'importFiles', label: t('fileTree.menu.importFiles') },
          { key: 'importFolder', label: t('fileTree.menu.importFolder') },
          { key: 'rename', label: t('fileTree.menu.rename') },
          { key: 'delete', label: t('fileTree.menu.delete') },
          contextMenu.item.type === 'folder'
            ? { key: 'createFolder', label: t('fileTree.menu.createFolder') }
            : null,
          contextMenu.item.type === 'folder'
            ? { key: 'createFile', label: t('fileTree.menu.createFile') }
            : null,
          { key: 'webPreview', label: t('fileTree.menu.webPreview') },
        ].filter(Boolean) as Array<{ key: string; label: string }>);

  const handleMenuAction = async (key: string, menuItem: FileItem | null) => {
    setContextMenu(null);
    const unix = terminalCommandRegistry.getUnixCommands(
      currentProjectName,
      currentProjectId || ''
    );

    if (key === 'createFile') {
      const fileName = prompt(t('fileTree.prompt.newFileName'));
      if (fileName && currentProjectId) {
        const basePath = menuItem?.type === 'folder' ? menuItem.path : undefined;
        const newFilePath = constructPath(basePath, fileName);
        await fileRepository.createFile(currentProjectId, newFilePath, '', 'file');
        if (onRefresh) setTimeout(onRefresh, 100);
      }
      return;
    }

    if (key === 'createFolder') {
      const folderName = prompt(t('fileTree.prompt.newFolderName'));
      if (folderName && currentProjectId) {
        const basePath = menuItem?.type === 'folder' ? menuItem.path : undefined;
        const newFolderPath = constructPath(basePath, folderName);
        await fileRepository.createFile(currentProjectId, newFolderPath, '', 'folder');
        if (onRefresh) setTimeout(onRefresh, 100);
      }
      return;
    }

    if (key === 'importFiles') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.onchange = async (e: any) => {
        const files: FileList = e.target.files;
        if (!files || files.length === 0) return;

        let baseTargetDir = '';
        if (menuItem) {
          if (menuItem.type === 'file')
            baseTargetDir = menuItem.path.substring(0, menuItem.path.lastIndexOf('/')) || '/';
          else if (menuItem.type === 'folder') baseTargetDir = menuItem.path || '/';
        }

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relPath = file.name;
          const normalizedBase = baseTargetDir.endsWith('/')
            ? baseTargetDir.slice(0, -1)
            : baseTargetDir;
          const targetAbsolutePath =
            `/projects/${currentProjectName}${normalizedBase}/${relPath}`.replace('//', '/');
          await importSingleFile(file, targetAbsolutePath, currentProjectName, currentProjectId);
        }
        if (onRefresh) setTimeout(onRefresh, 100);
      };
      input.click();
      return;
    }

    if (key === 'importFolder') {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
      input.onchange = async (e: any) => {
        const files: FileList = e.target.files;
        if (!files || files.length === 0) return;

        let baseTargetDir = '';
        if (menuItem) {
          if (menuItem.type === 'file')
            baseTargetDir = menuItem.path.substring(0, menuItem.path.lastIndexOf('/')) || '/';
          else if (menuItem.type === 'folder') baseTargetDir = menuItem.path || '/';
        }

        const ensureFoldersExist = async (projectId: string | undefined, folderPath: string) => {
          if (!projectId) return;
          const parts = folderPath.split('/').filter(Boolean);
          let acc = '';
          for (const part of parts) {
            acc += '/' + part;
            try {
              await fileRepository.createFile(projectId, acc, '', 'folder');
            } catch (err) {
              // ignore
            }
          }
        };

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const relative = (file as any).webkitRelativePath || file.name;
          const relParts = relative.split('/').filter(Boolean);
          const relPath = relParts.join('/');
          const normalizedBase = baseTargetDir.endsWith('/')
            ? baseTargetDir.slice(0, -1)
            : baseTargetDir;
          const targetAbsolutePath =
            `/projects/${currentProjectName}${normalizedBase}/${relPath}`.replace('//', '/');
          const fullRelPath = `${normalizedBase}/${relPath}`.replace('//', '/');
          const lastSlash = fullRelPath.lastIndexOf('/');
          if (lastSlash > 0) {
            const folderPath = fullRelPath.substring(0, lastSlash);
            await ensureFoldersExist(currentProjectId, folderPath);
          }
          await importSingleFile(file, targetAbsolutePath, currentProjectName, currentProjectId);
        }
        if (onRefresh) setTimeout(onRefresh, 100);
      };
      input.click();
      return;
    }

    if (!menuItem) return;

    if (key === 'open') {
      const kind = (menuItem as FileItem).isBufferArray ? 'binary' : 'editor';
      await openTab(menuItem, { kind });
    } else if (key === 'openPreview') {
      await handlePreview(menuItem);
    } else if (key === 'openCodeMirror') {
      if (menuItem.type === 'file') {
        if ((menuItem as FileItem).isBufferArray) {
          await openTab(menuItem, { kind: 'binary' });
        } else {
          await openTab({ ...menuItem, isCodeMirror: true }, { kind: 'editor' });
        }
      }
    } else if (key === 'download') {
      if (menuItem.type === 'file') {
        let content = menuItem.content;
        if (typeof content !== 'string') content = 'error fetching content';
        exportSingleFile({
          name: menuItem.name,
          content,
          isBufferArray: menuItem.isBufferArray,
          bufferContent: menuItem.bufferContent,
        });
      } else if (menuItem.type === 'folder') {
        await exportFolderZip(menuItem);
      }
    } else if (key === 'rename') {
      const newName = prompt(t('fileTree.prompt.rename'), menuItem.name);
      if (newName && newName !== menuItem.name) {
        try {
          const lastSlash = menuItem.path.lastIndexOf('/');
          const oldPath = `/projects/${currentProjectName}${menuItem.path}`;
          const newPath = `/projects/${currentProjectName}${menuItem.path.substring(0, lastSlash + 1)}${newName}`;
          await unix.rename(oldPath, newPath);
          if (onRefresh) setTimeout(onRefresh, 100);
        } catch (error: any) {
          alert(t('fileTree.alert.renameFailed', { params: { error: error.message } }));
        }
      }
    } else if (key === 'delete') {
      if (menuItem && currentProjectId) {
        await fileRepository.deleteFile(menuItem.id);
        if (onRefresh) setTimeout(onRefresh, 100);
      }
    } else if (key === 'webPreview') {
      handleWebPreview(menuItem);
    }
  };

  return (
    <div
      ref={contextMenuRef}
      style={{
        position: 'fixed',
        zIndex: 50,
        background: colors.cardBg,
        border: `1px solid ${colors.border}`,
        borderRadius: '0.5rem',
        minWidth: '120px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
        top: contextMenu.y,
        left: contextMenu.x,
        padding: '2px 0',
      }}
    >
      <ul className="py-0">
        {menuItems.map((mi, idx) => (
          <li
            key={mi.key}
            style={{
              padding: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.75rem',
              background: menuHoveredIdx === idx ? colors.accentBg : 'transparent',
              color: colors.foreground,
              borderTop: idx === 2 ? `1px solid ${colors.border}` : undefined,
              lineHeight: '1.2',
              minHeight: '24px',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              MozUserSelect: 'none',
              msUserSelect: 'none',
              touchAction: 'manipulation',
            }}
            onMouseEnter={() => setMenuHoveredIdx(idx)}
            onMouseLeave={() => setMenuHoveredIdx(null)}
            onTouchStart={() => setMenuHoveredIdx(idx)}
            onTouchEnd={() => setMenuHoveredIdx(null)}
            onClick={() => void handleMenuAction(mi.key, contextMenu.item)}
          >
            {mi.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
