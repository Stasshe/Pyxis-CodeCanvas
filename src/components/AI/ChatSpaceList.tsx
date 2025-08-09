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

    if (minutes < 1) return 'たった今';
    if (minutes < 60) return `${minutes}分前`;
    if (hours < 24) return `${hours}時間前`;
    if (days < 7) return `${days}日前`;
    return date.toLocaleDateString();
  };

  return (
    <div
      className="flex flex-col h-64 border rounded-lg overflow-hidden"
      style={{
        background: colors.background,
        borderColor: colors.border,
      }}
    >
      {/* ヘッダー */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{
          borderColor: colors.border,
          background: colors.cardBg,
        }}
      >
        <span className="text-sm font-semibold" style={{ color: colors.foreground }}>
          チャットスペース
        </span>
        <button
          className="text-xs px-2 py-1 rounded border font-medium hover:opacity-90 transition"
          style={{
            background: colors.accent,
            color: colors.accentFg,
            borderColor: colors.primary,
          }}
          onClick={() => onCreateSpace()}
        >
          + 新規
        </button>
      </div>

      {/* スペースリスト */}
      <div className="flex-1 overflow-y-auto">
        {chatSpaces.length === 0 ? (
          <div
            className="flex items-center justify-center h-full text-sm opacity-70"
            style={{ color: colors.mutedFg }}
          >
            スペースを作成してください
          </div>
        ) : (
          chatSpaces.map(space => (
            <div
              key={space.id}
              className={`p-3 border-b cursor-pointer hover:opacity-90 transition group ${
                currentSpace?.id === space.id ? 'bg-opacity-20' : ''
              }`}
              style={{
                borderColor: colors.border,
                background: currentSpace?.id === space.id ? colors.accent + '20' : 'transparent',
              }}
              onClick={() => onSelectSpace(space)}
            >
              <div className="flex items-center justify-between">
                {editingId === space.id ? (
                  <div className="flex-1 flex gap-1">
                    <input
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      className="flex-1 px-2 py-1 text-xs rounded border focus:outline-none"
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
                    <button
                      className="text-xs px-1 py-1 rounded hover:opacity-70"
                      style={{ color: colors.primary }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditSave(space.id);
                      }}
                    >
                      ✓
                    </button>
                    <button
                      className="text-xs px-1 py-1 rounded hover:opacity-70"
                      style={{ color: colors.mutedFg }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleEditCancel();
                      }}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1">
                      <div
                        className="text-sm font-medium truncate"
                        style={{ color: colors.foreground }}
                      >
                        {space.name}
                      </div>
                      <div
                        className="text-xs opacity-70 mt-1"
                        style={{ color: colors.mutedFg }}
                      >
                        {space.messages.length}件のメッセージ • {formatDate(space.updatedAt)}
                      </div>
                    </div>
                    <div className="opacity-0 group-hover:opacity-100 transition flex gap-1">
                      <button
                        className="text-xs px-1 py-1 rounded hover:opacity-70"
                        style={{ color: colors.mutedFg }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleEditStart(space);
                        }}
                        title="名前を変更"
                      >
                        ✏️
                      </button>
                      <button
                        className="text-xs px-1 py-1 rounded hover:opacity-70"
                        style={{ color: colors.destructive }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('このスペースを削除しますか？')) {
                            onDeleteSpace(space.id);
                          }
                        }}
                        title="削除"
                      >
                        🗑️
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
