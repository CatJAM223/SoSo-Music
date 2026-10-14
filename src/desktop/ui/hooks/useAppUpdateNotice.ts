import { useEffect, useState } from 'react';
import type { AppUpdateStatus } from '../../../shared/types';
const DISMISSED_KEY = 'soso_update_dismissed_version';
export function useAppUpdateNotice() {
  const [update, setUpdate] = useState<AppUpdateStatus | null>(null);
  useEffect(() => {
    let active = true,
      eventReceived = false;
    const receive = (status: AppUpdateStatus | null) => {
      if (!active || status?.status !== 'available' || !status.latestVersion) return;
      try {
        if (localStorage.getItem(DISMISSED_KEY) === status.latestVersion) return;
      } catch {}
      setUpdate(status);
    };
    const off = window.electronAPI?.onAppUpdateAvailable?.((status) => {
      eventReceived = true;
      receive(status);
    });
    void window.electronAPI
      ?.getAvailableAppUpdate?.()
      .then((status) => {
        if (!eventReceived) receive(status);
      })
      .catch(() => {});
    return () => {
      active = false;
      off?.();
    };
  }, []);
  const dismiss = () => {
    if (update?.latestVersion)
      try {
        localStorage.setItem(DISMISSED_KEY, update.latestVersion);
      } catch {}
    setUpdate(null);
  };
  return { update, dismiss };
}
