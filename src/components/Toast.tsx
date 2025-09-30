'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface ToastMessage {
  id: number;
  message: string;
  type: 'success' | 'error' | 'warn' | 'info';
}

let toastId = 0;
let addToast: (toast: ToastMessage) => void;

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);

    addToast = toast => {
      setToasts(prev => [...prev, toast]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== toast.id));
      }, 3000);
    };
  }, []);

  if (!isClient) return null;

  return createPortal(
    <div className="toast-container">
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`toast toast-${toast.type}`}
        >
          {toast.message}
        </div>
      ))}
    </div>,
    document.body
  );
};

export const showToast = {
  success: (message: string) => {
    if (addToast) addToast({ id: toastId++, message, type: 'success' });
  },
  error: (message: string) => {
    if (addToast) addToast({ id: toastId++, message, type: 'error' });
  },
  warn: (message: string) => {
    if (addToast) addToast({ id: toastId++, message, type: 'warn' });
  },
  info: (message: string) => {
    if (addToast) addToast({ id: toastId++, message, type: 'info' });
  },
};
