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
  onClick: () => void | Promise<void>;
}

export interface OperationWindowView {
  id: string;
  title: string;
  items: OperationListItem[];
  onActivate?: (item: OperationListItem) => void | Promise<void>;
  onEnter?: () => void | Promise<void>;
  headerActions?: OperationHeaderAction[];
  breadcrumb?: React.ReactNode;
  footer?: React.ReactNode;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
}
