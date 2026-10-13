import { useLibraryPersistenceNotifications } from '../hooks/useLibraryPersistenceNotifications';
import React, { createContext, useContext, useState, useCallback } from 'react';

export type ToastType = 'error' | 'warning' | 'info' | 'success';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
}

interface ToastContextType {
  toasts: ToastItem[];
  showToast: (message: string, type?: ToastType, duration?: number) => void;
  dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

let globalToastEmitter: ((message: string, type?: ToastType, duration?: number) => void) | null =
  null;

/**
 * Global static helper to trigger toasts from non-React service contexts
 */
export const emitToast = (message: string, type: ToastType = 'info', duration: number = 4000) => {
  if (globalToastEmitter) {
    globalToastEmitter(message, type, duration);
  }
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = 4000) => {
      if (!message) return;
      const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newToast: ToastItem = { id, message, type, duration };

      setToasts((prev) => {
        // Keep maximum 3 simultaneous toasts
        const persistent = prev.filter((toast) => toast.id === 'library-persistence');
        const filtered = prev
          .filter((toast) => toast.id !== 'library-persistence')
          .slice(-(2 - persistent.length));
        return [...persistent, ...filtered, newToast];
      });

      if (duration > 0) {
        setTimeout(() => {
          dismissToast(id);
        }, duration);
      }
    },
    [dismissToast],
  );

  // Bind global emitter for service layer
  React.useEffect(() => {
    globalToastEmitter = showToast;
    return () => {
      globalToastEmitter = null;
    };
  }, [showToast]);

  useLibraryPersistenceNotifications({ setToasts, showToast });

  // Online / Offline Global Network Monitoring
  React.useEffect(() => {
    const handleOnline = () => {
      showToast('Подключение к интернету восстановлено', 'success', 3000);
    };

    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [showToast]);

  return (
    <ToastContext.Provider value={{ toasts, showToast, dismissToast }}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastContextType => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return ctx;
};
