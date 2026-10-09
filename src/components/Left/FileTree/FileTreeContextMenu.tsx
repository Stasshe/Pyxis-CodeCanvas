import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '@/context/I18nContext';
import { useTheme } from '@/context/ThemeContext';
import { fsClient, getParentPath, resolvePath } from '@/engine/core/fs';
import { explorerMenuRegistry } from '@/engine/extensions/system-api/ExplorerMenuAPI';
import { exportFolderZip } from '@/engine/in-ex/exportFolderZip';
import { exportSingleFile } from '@/engine/in-ex/exportSingleFile';
import { importSingleFile } from '@/engine/in-ex/importSingleFile';
import { getCurrentRootPath } from '@/stores/projectStore';
import { tabActions } from '@/stores/tabState';
import type { FileItem } from '@/types';
import { fileTreeErrorMessage, reportFileTreeError } from './fileTreeErrors';
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

  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!menu) return;
    const placeMenu = () => {
      const bounds = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(0, Math.min(contextMenu.x, window.innerWidth - bounds.width))}px`;
      menu.style.top = `${Math.max(0, Math.min(contextMenu.y, window.innerHeight - bounds.height))}px`;
    };
    placeMenu();
    window.addEventListener('resize', placeMenu);
    return () => window.removeEventListener('resize', placeMenu);
  });

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

  const importFiles = (directory: string, folder: boolean, operationRootPath: string) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    if (folder) {
      input.setAttribute('webkitdirectory', '');
      input.setAttribute('directory', '');
    }
    input.onchange = () => {
      void (async () => {
        const files = input.files;
        if (!files) return;
        try {
          for (const file of Array.from(files)) {
            if (getCurrentRootPath() !== operationRootPath) {
              throw new Error(t('fileTree.alert.workspaceChanged'));
            }
            let relativePath = file.name;
            if (folder) relativePath = file.webkitRelativePath;
            const destination = resolvePath(directory, relativePath);
            if (getCurrentRootPath() !== operationRootPath) {
              throw new Error(t('fileTree.alert.workspaceChanged'));
            }
            await importSingleFile(
              file,
              destination,
              t('fileTree.alert.destinationExists', { params: { path: destination } }),
              () => getCurrentRootPath() === operationRootPath,
              t('fileTree.alert.workspaceChanged')
            );
          }
          refresh();
        } catch (error) {
          reportFileTreeError(
            t('fileTree.alert.operationFailed', {
              params: {
                action: t('fileTree.action.import'),
                error: fileTreeErrorMessage(error, path =>
                  t('fileTree.alert.destinationExists', { params: { path } })
                ),
              },
            })
          );
        }
      })();
    };
    input.click();
  };

  const handleMenuAction = async (key: string, item: FileItem | null) => {
    setContextMenu(null);
    const operationRootPath = rootPath;
    if (getCurrentRootPath() !== operationRootPath) {
      throw new Error(t('fileTree.alert.workspaceChanged'));
    }
    if (item && !isPathWithinRoot(item.path, operationRootPath)) {
      throw new Error(t('fileTree.alert.workspaceChanged'));
    }
    const extensionItem = extensionMenuItems.find(
      entry => `ext:${entry.extensionId}:${entry.definition.id}` === key
    );
    if (extensionItem && item) {
      await extensionItem.definition.handler(item, { rootPath });
      return;
    }

    if (key === 'createFile') {
      const name = prompt(t('fileTree.prompt.newFileName'));
      if (name) {
        const path = resolvePath(targetDirectory(item, rootPath), name);
        if (await fsClient.exists(path)) {
          throw new Error(t('fileTree.alert.destinationExists', { params: { path } }));
        }
        if (getCurrentRootPath() !== operationRootPath) {
          throw new Error(t('fileTree.alert.workspaceChanged'));
        }
        await fsClient.writeRange(path, new Uint8Array(), null, true, true);
        refresh();
      }
      return;
    }
    if (key === 'createFolder') {
      const name = prompt(t('fileTree.prompt.newFolderName'));
      if (name) {
        const path = resolvePath(targetDirectory(item, rootPath), name);
        if (await fsClient.exists(path)) {
          throw new Error(t('fileTree.alert.destinationExists', { params: { path } }));
        }
        if (getCurrentRootPath() !== operationRootPath) {
          throw new Error(t('fileTree.alert.workspaceChanged'));
        }
        await fsClient.mkdir(path);
        refresh();
      }
      return;
    }
    if (key === 'importFiles' || key === 'importFolder') {
      importFiles(
        targetDirectory(item, operationRootPath),
        key === 'importFolder',
        operationRootPath
      );
      return;
    }
    if (!item) return;

    if (key === 'open') {
      await openTab(item, { kind: 'editor', editorMode: 'monaco' });
    } else if (key === 'openPreview') {
      await openTab(item, { kind: 'preview' });
    } else if (key === 'openCodeMirror') {
      await openTab(item, { kind: 'editor', editorMode: 'codemirror' });
    } else if (key === 'download') {
      if (item.type === 'file') await exportSingleFile(item.path);
      if (item.type === 'folder') await exportFolderZip(item.path);
    } else if (key === 'rename') {
      const newName = prompt(t('fileTree.prompt.rename'), item.name);
      if (newName && newName !== item.name) {
        const destination = resolvePath(getParentPath(item.path), newName);
        if (await fsClient.exists(destination)) {
          throw new Error(t('fileTree.alert.destinationExists', { params: { path: destination } }));
        }
        if (
          getCurrentRootPath() !== operationRootPath ||
          !isPathWithinRoot(item.path, operationRootPath)
        ) {
          throw new Error(t('fileTree.alert.workspaceChanged'));
        }
        await fsClient.rename(item.path, destination, { overwrite: false });
        refresh();
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
        maxWidth: '100vw',
        maxHeight: '100vh',
        overflowY: 'auto',
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
            onClick={() =>
              void handleMenuAction(menuItem.key, contextMenu.item).catch(error => {
                reportFileTreeError(
                  t('fileTree.alert.operationFailed', {
                    params: {
                      action: menuItem.label,
                      error: fileTreeErrorMessage(error, path =>
                        t('fileTree.alert.destinationExists', { params: { path } })
                      ),
                    },
                  })
                );
              })
            }
          >
            {menuItem.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

function isPathWithinRoot(path: string, rootPath: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath.replace(/\/$/, '')}/`);
}
