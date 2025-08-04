'use client';

import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import '@/app/Toast.css';

interface ToastMessage {
  id: number;
  message: string;
  type?: 'success' | 'error' | 'info';
}

let toastId = 0;
let addToast: (message: string, type?: 'success' | 'error' | 'info') => void;

export const ToastContainer: React.FC = () => {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToast = (message, type = 'info') => {
      const id = toastId++;
      setToasts((prev) => [...prev, { id, message, type }]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, 3000); // 3秒で自動的に消える
    };
  }, []);

  return createPortal(
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}>
          {toast.message}
        </div>
      ))}
    </div>,
    document.body
  );
};

export const showToast = (message: string, type?: 'success' | 'error' | 'info') => {
  if (addToast) {
    addToast(message, type);
  }
};
