import { useCallback } from 'react';

export function useNativeModal() {
  return useCallback((dialog: HTMLDialogElement | null) => {
    if (!dialog) return;
    dialog.showModal();
    return () => dialog.close();
  }, []);
}
