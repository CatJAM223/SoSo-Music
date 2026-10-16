import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/locale';
export function useOverlaySettings(active: boolean) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const revision = useRef(0);
  useEffect(() => {
    const ticket = ++revision.current;
    setBusy(false);
    setError('');
    setEnabled(null);
    if (active)
      void window.electronAPI
        ?.getDesktopControls?.()
        .then((value) => {
          if (ticket === revision.current) setEnabled(value.overlayEnabled);
        })
        .catch(() => {
          if (ticket === revision.current) setError(t('Не удалось загрузить настройки оверлея.'));
        });
    return () => {
      revision.current++;
    };
  }, [active]);
  async function save(value: boolean) {
    if (busy || !window.electronAPI?.setPlayerOverlayEnabled) return false;
    const ticket = ++revision.current;
    setBusy(true);
    setError('');
    try {
      const status = await window.electronAPI.setPlayerOverlayEnabled(value);
      if (ticket !== revision.current) return false;
      setEnabled(status.overlayEnabled);
      return true;
    } catch {
      if (ticket === revision.current) setError(t('Не удалось сохранить настройки оверлея.'));
      return false;
    } finally {
      if (ticket === revision.current) setBusy(false);
    }
  }
  async function edit() {
    if (enabled !== true || busy || !window.electronAPI?.editPlayerOverlay) return false;
    const ticket = ++revision.current;
    setBusy(true);
    setError('');
    try {
      await window.electronAPI.editPlayerOverlay();
      return ticket === revision.current;
    } catch {
      if (ticket === revision.current) setError(t('Не удалось открыть настройку оверлея.'));
      return false;
    } finally {
      if (ticket === revision.current) setBusy(false);
    }
  }
  return { enabled, busy, error, save, edit };
}
