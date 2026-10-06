import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { fsClient, getParentPath, resolvePath } from '@/engine/core/fs';
import { explorerMenuRegistry } from '@/engine/extensions/system-api/ExplorerMenuAPI';
import { exportFolderZip } from '@/engine/in-ex/exportFolderZip';
import { exportSingleFile } from '@/engine/in-ex/exportSingleFile';
import { importSingleFile } from '@/engine/in-ex/importSingleFile';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types';
import type { ContextMenuState } from './types';

interface FileTreeContextMenuProps {
  contextMenu: ContextMenuState;
  setContextMenu: (menu: ContextMenuState | null) => void;
  rootPath: string;
  onRefresh?: () => void;
}

function targetDirectory(item: FileItem | null, rootPath: string): string {
  if (!item) return rootPath;
  if (item.type === 'folder') return item.path;
  return getParentPath(item.path);
}

export default function FileTreeContextMenu({
  contextMenu,
  setContextMenu,
  rootPath,
  onRefresh,
}: FileTreeContextMenuProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { openTab } = tabActions;
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [, forceUpdate] = useState(0);

  useEffect(
    () => explorerMenuRegistry.addChangeListener(() => forceUpdate(value => value + 1)),
    []
  );

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [setContextMenu]);

  const extensionMenuItems = useMemo(
    () => explorerMenuRegistry.getMenuItemsForFile(contextMenu.item),
    [contextMenu.item]
  );
  const menuItems: Array<{ key: string; label: string; isExtension?: boolean }> = [];
  const selectedItem = contextMenu.item;
  if (selectedItem) {
    if (selectedItem.type === 'file') {
      menuItems.push({ key: 'open', label: t('fileTree.menu.open') });
      if (selectedItem.name.endsWith('.md')) {
        menuItems.push({ key: 'openPreview', label: t('fileTree.menu.openPreview') });
      }
      menuItems.push({ key: 'openCodeMirror', label: t('fileTree.menu.openCodeMirror') });
    }
    for (const menuItem of extensionMenuItems) {
      menuItems.push({
        key: `ext:${menuItem.extensionId}:${menuItem.definition.id}`,
        label: menuItem.definition.label,
        isExtension: true,
      });
    }
    menuItems.push(
      { key: 'download', label: t('fileTree.menu.download') },
      { key: 'importFiles', label: t('fileTree.menu.importFiles') },
      { key: 'importFolder', label: t('fileTree.menu.importFolder') },
      { key: 'rename', label: t('fileTree.menu.rename') },
      { key: 'delete', label: t('fileTree.menu.delete') }
    );
    if (selectedItem.type === 'folder') {
      menuItems.push(
        { key: 'createFolder', label: t('fileTree.menu.createFolder') },
        { key: 'createFile', label: t('fileTree.menu.createFile') }
      );
    }
    menuItems.push({ key: 'webPreview', label: t('fileTree.menu.webPreview') });
  } else {
    menuItems.push(
      { key: 'createFile', label: t('fileTree.menu.createFile') },
      { key: 'createFolder', label: t('fileTree.menu.createFolder') },
      { key: 'importFiles', label: t('fileTree.menu.importFiles') },
      { key: 'importFolder', label: t('fileTree.menu.importFolder') }
    );
  }

  const refresh = () => {
    if (onRefresh) window.setTimeout(onRefresh, 100);
  };

  const importFiles = (directory: string, folder: boolean) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.onchange = async () => {
      const files = input.files;
      if (!files) return;
      for (const file of Array.from(files)) {
        let relativePath = file.name;
        if (folder) relativePath = file.webkitRelativePath;
        await importSingleFile(file, resolvePath(directory, relativePath));
      }
      refresh();
    };
    input.click();
  };

  const handleMenuAction = async (key: string, item: FileItem | null) => {
    setContextMenu(null);
    const extensionItem = extensionMenuItems.find(
      entry => `ext:${entry.extensionId}:${entry.definition.id}` === key
    );
    if (extensionItem && item) {
      try {
        await extensionItem.definition.handler(item, {
          rootPath,
        });
      } catch (error) {
        console.error('[FileTreeContextMenu] Extension menu action failed:', error);
      }
      return;
    }

    if (key === 'createFile') {
      const name = prompt(t('fileTree.prompt.newFileName'));
      if (name) {
        await fsClient.writeFile(resolvePath(targetDirectory(item, rootPath), name), '');
        refresh();
      }
      return;
    }
    if (key === 'createFolder') {
      const name = prompt(t('fileTree.prompt.newFolderName'));
      if (name) {
        await fsClient.mkdir(resolvePath(targetDirectory(item, rootPath), name));
        refresh();
      }
      return;
    }
    if (key === 'importFiles' || key === 'importFolder') {
      importFiles(targetDirectory(item, rootPath), key === 'importFolder');
      return;
    }
    if (!item) return;

    if (key === 'open') {
      await openTab(item, { kind: 'editor' });
    } else if (key === 'openPreview') {
      await openTab(item, { kind: 'preview' });
    } else if (key === 'openCodeMirror') {
      await openTab({ ...item, isCodeMirror: true }, { kind: 'editor' });
    } else if (key === 'download') {
      if (item.type === 'file') await exportSingleFile(item.path);
      if (item.type === 'folder') await exportFolderZip(item.path);
    } else if (key === 'rename') {
      const newName = prompt(t('fileTree.prompt.rename'), item.name);
      if (newName && newName !== item.name) {
        try {
          await fsClient.rename(item.path, resolvePath(getParentPath(item.path), newName));
          refresh();
        } catch (error) {
          let message = String(error);
          if (error instanceof Error) message = error.message;
          alert(t('fileTree.alert.renameFailed', { params: { error: message } }));
        }
      }
    } else if (key === 'delete') {
      await fsClient.rm(item.path, { recursive: item.type === 'folder' });
      refresh();
    } else if (key === 'webPreview') {
      await openTab(item, { kind: 'webPreview', rootPath });
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
        {menuItems.map((menuItem, index) => (
          <li
            key={menuItem.key}
            style={{
              padding: '0.5rem',
              cursor: 'pointer',
              fontSize: '0.75rem',
              color: colors.foreground,
              lineHeight: '1.2',
              minHeight: '24px',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              touchAction: 'manipulation',
            }}
            className="hover:bg-accent"
            onClick={() => void handleMenuAction(menuItem.key, contextMenu.item)}
          >
            {menuItem.label}
          </li>
        ))}
      </ul>
    </div>
  );
}
