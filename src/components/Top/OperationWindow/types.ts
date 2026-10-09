import type React from 'react';

export interface OperationListItem {
  id: string;
  label: string;
  description?: string;
  icon?: React.ReactNode | string;
  onClick?: () => void | Promise<void>;
  isActive?: boolean;
  isEditing?: boolean;
  editValue?: string;
  onEditChange?: (value: string) => void;
  onEditConfirm?: () => void | Promise<void>;
  onEditCancel?: () => void;
  actions?: {
    id: string;
    icon: React.ReactNode;
    label: string;
    onClick: (e: React.MouseEvent) => void;
    danger?: boolean;
  }[];
}

export interface OperationHeaderAction {
  id: string;
  icon: React.ReactNode;
  label: string;
  onClick: (selectedItem?: OperationListItem) => void | Promise<void>;
}

export interface OperationWindowInput {
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onConfirm: (selectedItem?: OperationListItem) => void | Promise<void>;
}

export interface OperationWindowView {
  id: string;
  title: string;
  items: OperationListItem[];
  onActivate?: (item: OperationListItem) => void | Promise<void>;
  onEnter?: () => void | Promise<void>;
  input?: OperationWindowInput;
  headerActions?: OperationHeaderAction[];
  footer?: React.ReactNode;
  loading?: boolean;
  actionBusy?: boolean;
  error?: string | null;
  emptyMessage?: string;
  placeholder?: string;
  showTitle?: boolean;
}
