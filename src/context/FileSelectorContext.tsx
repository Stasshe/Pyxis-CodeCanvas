// src/context/FileSelectorContext.tsx
'use client';
import React, { createContext, useContext, useState, ReactNode } from 'react';

interface FileSelectorContextValue {
  isOpen: boolean;
  targetPaneId: string | null;
  openFileSelector: (paneId: string) => void;
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

  const openFileSelector = (paneId: string) => {
    setTargetPaneId(paneId);
    setIsOpen(true);
  };

  const closeFileSelector = () => {
    setIsOpen(false);
    setTargetPaneId(null);
  };

  return (
    <FileSelectorContext.Provider
      value={{
        isOpen,
        targetPaneId,
        openFileSelector,
        closeFileSelector,
      }}
    >
      {children}
    </FileSelectorContext.Provider>
  );
};
