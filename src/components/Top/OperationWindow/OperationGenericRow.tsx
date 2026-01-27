'use client';

import React, { useMemo } from 'react';
import type { OperationListItem } from './OperationWindow';
import { highlightMatch } from '@/components/Top/OperationWindow/OperationUtils';

interface Props {
  item: OperationListItem;
  isSelected: boolean;
  ITEM_HEIGHT: number;
  colors: any;
  queryTokens: string[];
}

function OperationGenericRowInner({ item, isSelected, ITEM_HEIGHT, colors, queryTokens }: Props) {
  const highlightedLabel = useMemo(
    () => highlightMatch(item.label, queryTokens, isSelected, colors),
    [item.label, queryTokens, isSelected, colors]
  );

  const highlightedDesc = useMemo(
    () => (item.description ? highlightMatch(item.description, queryTokens, isSelected, colors) : null),
    [item.description, queryTokens, isSelected, colors]
  );

  return (
    <div
      className="group"
      style={{
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
        padding: '2px 12px',
        background: isSelected ? colors.primary : 'transparent',
        color: isSelected ? colors.cardBg : colors.foreground,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        borderLeft: isSelected ? `3px solid ${colors.accentBg}` : '3px solid transparent',
        position: 'relative',
      }}
      onClick={() => !item.isEditing && item.onClick?.()}
    >
      {item.icon && (
        <div style={{ width: 16, height: 16, flex: '0 0 16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          {typeof item.icon === 'string' ? <img src={item.icon} alt="" style={{ width: '100%', height: '100%' }} /> : item.icon}
        </div>
      )}

      {item.isEditing ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '4px' }}>
          <input
            type="text"
            value={item.editValue ?? item.label}
            onChange={e => item.onEditChange?.(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.stopPropagation();
                item.onEditConfirm?.();
              } else if (e.key === 'Escape') {
                e.stopPropagation();
                item.onEditCancel?.();
              }
            }}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1,
              height: '18px',
              fontSize: '13px',
              padding: '0 4px',
              border: `1px solid ${colors.accent}`,
              background: colors.background,
              color: colors.foreground,
              borderRadius: '2px',
              outline: 'none',
            }}
          />
        </div>
      ) : (
        <>
          <span style={{ fontSize: '13px', fontWeight: isSelected || item.isActive ? '600' : '400', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
            {highlightedLabel}
          </span>
          {item.description && (
            <span style={{ fontSize: '11px', color: isSelected ? 'rgba(255,255,255,0.8)' : colors.mutedFg, marginLeft: '8px' }}>
              {highlightedDesc}
            </span>
          )}
        </>
      )}

      {!item.isEditing && item.actions && item.actions.length > 0 && (
        <div style={{ display: isSelected ? 'flex' : 'none', gap: '4px', marginLeft: 'auto' }}>
          {item.actions.map(action => (
            <button
              key={action.id}
              onClick={e => {
                e.stopPropagation();
                action.onClick(e);
              }}
              title={action.label}
              style={{
                background: 'transparent',
                border: 'none',
                color: action.danger ? (isSelected ? '#ffcccc' : colors.destructive) : isSelected ? 'white' : colors.foreground,
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '3px',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              {action.icon}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default React.memo(OperationGenericRowInner, (prev, next) => {
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.ITEM_HEIGHT !== next.ITEM_HEIGHT) return false;
  if (prev.colors !== next.colors) return false;
  if (prev.item.id !== next.item.id) return false;
  if (prev.item.label !== next.item.label) return false;
  if (prev.item.description !== next.item.description) return false;
  const a = prev.queryTokens || [];
  const b = next.queryTokens || [];
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
});
