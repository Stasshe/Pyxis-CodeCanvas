'use client'
import { memo, useMemo } from 'react'
import { useDragLayer } from 'react-dnd'
import { getIconForFile, getIconForFolder } from 'vscode-icons-js'

import { DND_FILE_TREE_ITEM, DND_TAB } from '@/constants/dndTypes'
import { useTheme } from '@/context/ThemeContext'

/**
 * 共通カスタムドラッグレイヤー
 * FileTreeとTabBarの両方で使用するドラッグプレビューを表示
 */
const CustomDragLayer = memo(function CustomDragLayer() {
  const { colors } = useTheme()
  const { isDragging, item, itemType, currentOffset } = useDragLayer(monitor => ({
    item: monitor.getItem(),
    itemType: monitor.getItemType(),
    currentOffset: monitor.getSourceClientOffset(),
    isDragging: monitor.isDragging(),
  }))

  // アイテム情報をメモ化
  const { iconSrc, name, isFolder } = useMemo(() => {
    if (!item) {
      return { iconSrc: '', name: '', isFolder: false }
    }

    // FILE_TREE_ITEMの場合
    if (itemType === DND_FILE_TREE_ITEM && item.item) {
      const fileItem = item.item
      const isFolder = fileItem.type === 'folder'
      const iconPath = isFolder
        ? getIconForFolder(fileItem.name) || getIconForFolder('')
        : getIconForFile(fileItem.name) || getIconForFile('')
      const iconSrc =
        iconPath && iconPath.endsWith('.svg')
          ? `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`
          : `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${isFolder ? 'folder.svg' : 'file.svg'}`
      return { iconSrc, name: fileItem.name, isFolder }
    }

    // TABの場合
    if (itemType === DND_TAB && item.tabName) {
      const iconPath = getIconForFile(item.tabName) || getIconForFile('')
      const iconSrc =
        iconPath && iconPath.endsWith('.svg')
          ? `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/${iconPath.split('/').pop()}`
          : `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/vscode-icons/file.svg`
      return { iconSrc, name: item.tabName, isFolder: false }
    }

    return { iconSrc: '', name: '', isFolder: false }
  }, [item, itemType])

  if (!isDragging || !item || !currentOffset || !name) {
    return null
  }

  return (
    <div
      style={{
        position: 'fixed',
        pointerEvents: 'none',
        zIndex: 9999,
        left: 0,
        top: 0,
        transform: `translate(${currentOffset.x}px, ${currentOffset.y}px)`,
        willChange: 'transform',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          background: colors.background,
          border: `1px solid ${colors.border}`,
          borderRadius: '4px',
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
          fontSize: '13px',
          color: colors.foreground,
          whiteSpace: 'nowrap',
        }}
      >
        <img src={iconSrc} alt={isFolder ? 'folder' : 'file'} style={{ width: 16, height: 16 }} />
        <span>{name}</span>
      </div>
    </div>
  )
})

export default CustomDragLayer
