import { useState } from 'react';
import { Confirmation } from '@/components/Confirmation';
import { useTranslation } from '@/context/I18nContext';

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

  const { t } = useTranslation();
  const ConfirmationDialog = (
    <Confirmation
      open={confirmState.open}
      title={t('tabCloseConfirmation.discardChangesTitle')}
      message={t('tabCloseConfirmation.discardChangesMessage')}
      confirmText={t('tabCloseConfirmation.discardAndClose')}
      cancelText={t('tabCloseConfirmation.cancel')}
      onConfirm={() => {
        confirmState.onConfirm?.();
      }}
      onCancel={() => setConfirmState(s => ({ ...s, open: false }))}
    />
  );

  return { requestClose, ConfirmationDialog };
}
