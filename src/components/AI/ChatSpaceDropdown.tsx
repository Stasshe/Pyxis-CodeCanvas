'use client';

import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import ChatSpaceList from './ChatSpaceList';
import type { ChatSpace } from '@/types';

interface ChatSpaceDropdownProps {
  anchorRect: DOMRect | null;
  onClose: () => void;
  chatSpaces: ChatSpace[];
  currentSpace: ChatSpace | null;
  onSelectSpace: (space: ChatSpace) => void;
  onCreateSpace: (name?: string) => void;
  onDeleteSpace: (spaceId: string) => void;
  onUpdateSpaceName: (spaceId: string, newName: string) => void;
}

export default function ChatSpaceDropdown({
  anchorRect,
  onClose,
  chatSpaces,
  currentSpace,
  onSelectSpace,
  onCreateSpace,
  onDeleteSpace,
  onUpdateSpaceName,
}: ChatSpaceDropdownProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  // click outside で閉じる
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (e.target instanceof Node && !ref.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [onClose]);

  if (!anchorRect) return null;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: anchorRect.left,
    top: anchorRect.bottom + 8, // small gap
    minWidth: 200,
    zIndex: 9999,
  };

  const node = (
    <div
      ref={ref}
      style={style}
    >
      <ChatSpaceList
        chatSpaces={chatSpaces}
        currentSpace={currentSpace}
        onSelectSpace={space => {
          onSelectSpace(space);
          onClose();
        }}
        onCreateSpace={onCreateSpace}
        onDeleteSpace={onDeleteSpace}
        onUpdateSpaceName={onUpdateSpaceName}
      />
    </div>
  );

  return createPortal(node, document.body);
}
