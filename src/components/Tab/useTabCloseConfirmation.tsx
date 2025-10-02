import { useState } from 'react';
import { Confirmation } from '@/components/Confirmation';

export function useTabCloseConfirmation() {
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    tabId: string | null;
    onConfirm: (() => void) | null;
  }>({ open: false, tabId: null, onConfirm: null });

  const requestClose = (tabId: string, isDirty: boolean, onClose: (tabId: string) => void) => {
    if (isDirty) {
      setConfirmState({
        open: true,
        tabId,
        onConfirm: () => {
          setConfirmState(s => ({ ...s, open: false }));
          onClose(tabId);
        },
      });
    } else {
      onClose(tabId);
    }
  };

  const ConfirmationDialog = (
    <Confirmation
      open={confirmState.open}
      title="変更を破棄しますか？"
      message="このタブには保存されていない変更があります。本当に閉じますか？"
      confirmText="破棄して閉じる"
      cancelText="キャンセル"
      onConfirm={() => {
        confirmState.onConfirm?.();
      }}
      onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
    />
  );

  return { requestClose, ConfirmationDialog };
}
