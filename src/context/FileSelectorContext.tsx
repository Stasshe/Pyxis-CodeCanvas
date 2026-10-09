// src/context/FileSelectorContext.tsx
import type React from 'react';
import { createContext, type ReactNode, useCallback, useContext, useState } from 'react';

export type OperationViewId = 'files' | 'folders' | 'recent';

interface FileSelectorContextValue {
  isOpen: boolean;
  targetPaneId: string | null;
  initialViewId: OperationViewId | null;
  openFileSelector: (paneId: string, initialViewId?: OperationViewId) => void;
  closeFileSelector: () => void;
}

const FileSelectorContext = createContext<FileSelectorContextValue | null>(null);

export const useFileSelector = () => {
  const context = useContext(FileSelectorContext);
  if (!context) {
    throw new Error('useFileSelector must be used within FileSelectorProvider');
  }
  return context;
};

interface FileSelectorProviderProps {
  children: ReactNode;
}

export const FileSelectorProvider: React.FC<FileSelectorProviderProps> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [targetPaneId, setTargetPaneId] = useState<string | null>(null);
  const [initialViewId, setInitialViewId] = useState<OperationViewId | null>(null);

  const openFileSelector = useCallback((paneId: string, viewId: OperationViewId = 'files') => {
    setTargetPaneId(paneId);
    setInitialViewId(viewId);
    setIsOpen(true);
  }, []);

  const closeFileSelector = useCallback(() => {
    setIsOpen(false);
    setTargetPaneId(null);
    setInitialViewId(null);
  }, []);

  return (
    <FileSelectorContext.Provider
      value={{
        isOpen,
        targetPaneId,
        initialViewId,
        openFileSelector,
        closeFileSelector,
      }}
    >
      {children}
    </FileSelectorContext.Provider>
  );
};
