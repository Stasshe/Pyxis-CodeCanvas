'use client';

import React, { useState } from 'react';
import { useTheme } from '@/context/ThemeContext';
import type { ChatSpace } from '@/types';

interface ChatSpaceListProps {
  chatSpaces: ChatSpace[];
  currentSpace: ChatSpace | null;
  onSelectSpace: (space: ChatSpace) => void;
  onCreateSpace: (name?: string) => void;
  onDeleteSpace: (spaceId: string) => void;
  onUpdateSpaceName: (spaceId: string, newName: string) => void;
}

export default function ChatSpaceList({
  chatSpaces,
  currentSpace,
  onSelectSpace,
  onCreateSpace,
  onDeleteSpace,
  onUpdateSpaceName
}: ChatSpaceListProps) {
  const { colors } = useTheme();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  // スペースが10個を超えた場合、古いものから削除する
  const handleCreateSpace = (name?: string) => {
    if (chatSpaces.length >= 10) {
      // updatedAtが古い順にソートし、超過分を削除
      const sorted = [...chatSpaces].sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime());
      const toDelete = sorted.slice(0, chatSpaces.length - 9); // 1つ追加するので9個残す
      toDelete.forEach(space => onDeleteSpace(space.id));
    }
    onCreateSpace(name);
  };

  const handleEditStart = (space: ChatSpace) => {
    setEditingId(space.id);
    setEditingName(space.name);
  };

  const handleEditSave = (spaceId: string) => {
    if (editingName.trim()) {
      onUpdateSpaceName(spaceId, editingName.trim());
    }
    setEditingId(null);
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditingName('');
  };

  const formatDate = (date: Date) => {
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '今';
    if (minutes < 60) return `${minutes}m`;
    if (hours < 24) return `${hours}h`;
    if (days < 7) return `${days}d`;
    return date.toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' });
  };

  return (
    <div className="space-y-2">
      {/* 新規作成ボタン */}
      <button
        className="w-full flex items-center gap-2 text-xs px-2 py-1.5 rounded border hover:opacity-90 transition"
        style={{
          background: colors.mutedBg,
          color: colors.foreground,
          borderColor: colors.border,
        }}
        onClick={() => handleCreateSpace()}
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
        </svg>
          新しいスペースを作成
      </button>

      {/* スペースリスト */}
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {chatSpaces.length === 0 ? (
          <div
            className="text-xs py-2 text-center opacity-60"
            style={{ color: colors.mutedFg }}
          >
            まだスペースがありません
          </div>
        ) : (
          chatSpaces.map(space => (
            <div
              key={space.id}
              className={`group flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:opacity-90 transition ${
                currentSpace?.id === space.id ? 'ring-1' : ''
              }`}
              style={{
                background: currentSpace?.id === space.id ? colors.accent + '15' : colors.mutedBg,
                borderColor: currentSpace?.id === space.id ? colors.accent : 'transparent',
                ...(currentSpace?.id === space.id && { ringColor: colors.accent }),
              }}
              onClick={() => onSelectSpace(space)}
            >
              {editingId === space.id ? (
                <>
                  <input
                    type="text"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    className="flex-1 px-1 py-0.5 text-xs rounded border focus:outline-none focus:ring-1 focus:ring-blue-500"
                    style={{
                      background: colors.background,
                      color: colors.foreground,
                      borderColor: colors.border,
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        handleEditSave(space.id);
                      } else if (e.key === 'Escape') {
                        handleEditCancel();
                      }
                    }}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="flex gap-0.5">
                    <button
                      className="p-0.5 rounded hover:bg-opacity-70"
                      style={{ color: colors.accent }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditSave(space.id);
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-opacity-70"
                      style={{ color: colors.mutedFg }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditCancel();
                      }}
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </>
              ) : (
                <>
                  {/* スペースアイコン */}
                  <div
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{
                      background: currentSpace?.id === space.id ? colors.accent : colors.mutedFg,
                    }}
                  ></div>

                  {/* スペース情報 */}
                  <div className="flex-1 min-w-0">
                    <div
                      className="text-xs font-medium truncate"
                      style={{ color: colors.foreground }}
                    >
                      {space.name}
                    </div>
                    <div
                      className="text-xs opacity-70 flex items-center gap-1"
                      style={{ color: colors.mutedFg }}
                    >
                      <svg className="w-2.5 h-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                      </svg>
                      <span>{space.messages.length}</span>
                      <span>•</span>
                      <span>{formatDate(space.updatedAt)}</span>
                    </div>
                  </div>

                  {/* アクションボタン */}
                  <div className="opacity-0 group-hover:opacity-100 transition flex gap-0.5">
                    <button
                      className="p-0.5 rounded hover:bg-opacity-70"
                      style={{ color: colors.mutedFg }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditStart(space);
                      }}
                      title="名前を変更"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                      </svg>
                    </button>
                    <button
                      className="p-0.5 rounded hover:bg-opacity-70"
                      style={{ color: colors.destructive }}
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm('このスペースを削除しますか？')) {
                          onDeleteSpace(space.id);
                        }
                      }}
                      title="削除"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
