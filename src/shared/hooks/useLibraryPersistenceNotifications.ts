import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { ToastItem, ToastType } from '../context/ToastContext';
import type { LibraryPersistenceStatus } from '../types';

type Props = {
  setToasts: Dispatch<SetStateAction<ToastItem[]>>;
  showToast: (message: string, type?: ToastType, duration?: number) => void;
};
export function useLibraryPersistenceNotifications({ setToasts, showToast }: Props) {
  useEffect(() => {
    let active = true,
      receivedEvent = false,
      lastStatus = '';
    const receive = (status: LibraryPersistenceStatus) => {
      if (!active) return;
      const key = status.state + ':' + (status.message || '');
      if (key === lastStatus) return;
      lastStatus = key;
      const message = (
        status.message || 'Не удалось сохранить медиатеку. Проверьте диск перед выходом.'
      ).slice(0, 2000);
      setToasts((prev) => {
        const remaining = prev.filter((toast) => toast.id !== 'library-persistence');
        return status.state === 'error'
          ? [...remaining, { id: 'library-persistence', message, type: 'error', duration: 0 }]
          : remaining;
      });
      if (status.state === 'recovered')
        showToast(
          'Медиатека восстановлена из резервной копии. Исходный файл сохранён отдельно.',
          'warning',
          8000,
        );
    };
    const unsubscribe = window.electronAPI?.onLibraryPersistenceStatus?.((status) => {
      receivedEvent = true;
      receive(status);
    });
    void window.electronAPI
      ?.getLibraryPersistenceStatus?.()
      .then((status) => {
        if (!receivedEvent) receive(status);
      })
      .catch(() => {});
    const mobileError = (event: Event) => {
      receivedEvent = true;
      receive({
        state: 'error',
        message: (event as CustomEvent<{ message?: string }>).detail?.message,
      });
    };
    window.addEventListener('soso:storage-error', mobileError);
    return () => {
      active = false;
      unsubscribe?.();
      window.removeEventListener('soso:storage-error', mobileError);
    };
  }, [setToasts, showToast]);
}
