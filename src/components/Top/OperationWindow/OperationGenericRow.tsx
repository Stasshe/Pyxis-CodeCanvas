import React, { useEffect, useRef } from 'react';
import { highlightMatch } from '@/components/Top/OperationWindow/OperationUtils';
import type { ThemeColors } from '@/context/ThemeContext';
import type { OperationListItem } from './types';

interface Props {
  item: OperationListItem;
  isSelected: boolean;
  ITEM_HEIGHT: number;
  colors: ThemeColors;
  queryTokens: string[];
  optionId: string;
  onActivate: (item: OperationListItem) => void;
  disabled: boolean;
}

function OperationGenericRowInner({
  item,
  isSelected,
  ITEM_HEIGHT,
  colors,
  queryTokens,
  optionId,
  onActivate,
  disabled,
}: Props) {
  const editInputRef = useRef<HTMLInputElement>(null);
  const highlightedLabel = highlightMatch(item.label, queryTokens, isSelected, colors);
  let highlightedDescription: React.ReactNode = null;
  if (item.description) {
    highlightedDescription = highlightMatch(item.description, queryTokens, isSelected, colors);
  }

  useEffect(() => {
    if (!item.isEditing) return;
    editInputRef.current?.focus();
    editInputRef.current?.select();
  }, [item.isEditing]);

  let background = 'transparent';
  let color = colors.foreground;
  let descriptionColor = colors.mutedFg;
  if (isSelected) {
    background = colors.editorSelection;
    color = colors.editorFg;
    descriptionColor = colors.editorFg;
  }

  let iconContent: React.ReactNode = null;
  if (item.icon) {
    if (typeof item.icon === 'string') {
      iconContent = <img src={item.icon} alt="" style={{ width: '100%', height: '100%' }} />;
    } else {
      iconContent = item.icon;
    }
  }

  let rowContent: React.ReactNode;
  if (item.isEditing) {
    rowContent = (
      <input
        ref={editInputRef}
        data-operation-edit
        type="text"
        value={item.editValue ?? item.label}
        onChange={event => item.onEditChange?.(event.target.value)}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter') {
            event.stopPropagation();
            item.onEditConfirm?.();
          }
          if (event.key === 'Escape') {
            event.stopPropagation();
            item.onEditCancel?.();
          }
        }}
        onClick={event => event.stopPropagation()}
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
    );
  } else {
    let labelWeight = '400';
    if (item.isActive) labelWeight = '600';
    rowContent = (
      <>
        <span
          style={{
            fontSize: '13px',
            fontWeight: labelWeight,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: '0 1 auto',
            minWidth: 0,
            maxWidth: '65%',
          }}
        >
          {highlightedLabel}
        </span>
        {item.description && (
          <span
            style={{
              fontSize: '11px',
              color: descriptionColor,
              minWidth: 0,
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {highlightedDescription}
          </span>
        )}
      </>
    );
  }

  let actionContent: React.ReactNode = null;
  if (!item.isEditing && item.actions?.length) {
    let actionDisplay = 'none';
    if (isSelected) actionDisplay = 'flex';
    actionContent = (
      <div style={{ display: actionDisplay, gap: '4px', marginLeft: 'auto' }}>
        {item.actions.map(action => {
          let actionColor = colors.foreground;
          if (action.danger) actionColor = colors.destructive;
          if (isSelected && !action.danger) actionColor = colors.editorFg;
          return (
            <button
              key={action.id}
              type="button"
              aria-label={action.label}
              disabled={disabled}
              onClick={event => {
                event.stopPropagation();
                action.onClick(event);
              }}
              title={action.label}
              style={{
                background: 'transparent',
                border: 'none',
                color: actionColor,
                cursor: 'pointer',
                padding: '2px',
                display: 'flex',
                alignItems: 'center',
                borderRadius: '3px',
              }}
              onMouseEnter={event => (event.currentTarget.style.background = colors.mutedBg)}
              onMouseLeave={event => (event.currentTarget.style.background = 'transparent')}
            >
              {action.icon}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div
      id={optionId}
      role="option"
      aria-selected={isSelected}
      className="group"
      style={{
        height: ITEM_HEIGHT,
        boxSizing: 'border-box',
        padding: '0 6px',
        background,
        color,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        minWidth: 0,
        position: 'relative',
      }}
      onClick={() => !item.isEditing && onActivate(item)}
    >
      {item.icon && (
        <div
          style={{
            width: 16,
            height: 16,
            flex: '0 0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {iconContent}
        </div>
      )}
      {rowContent}
      {actionContent}
    </div>
  );
}

export default React.memo(OperationGenericRowInner);
