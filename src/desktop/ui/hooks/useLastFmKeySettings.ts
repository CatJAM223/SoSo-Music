import { useEffect, useRef, useState } from 'react';
import { t } from '../../../shared/i18n/locale';

export function useLastFmKeySettings(active: boolean) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState('');
  const generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    setBusy(false);
    setFeedback('');
    setKey('');
    setConfigured(null);
    if (active && window.electronAPI?.getLastFmApiKeyStatus)
      void window.electronAPI
        .getLastFmApiKeyStatus()
        .then((status) => {
          if (generation.current === ticket) setConfigured(status.configured);
        })
        .catch(() => {
          if (generation.current === ticket)
            setFeedback(t('Не удалось прочитать настройки Last.fm.'));
        });
    return () => {
      generation.current++;
    };
  }, [active]);
  const save = async (value = key) => {
    if (busy || !window.electronAPI?.saveLastFmApiKey) return;
    const ticket = ++generation.current;
    setBusy(true);
    setFeedback('');
    try {
      const status = await window.electronAPI.saveLastFmApiKey(value.trim());
      if (generation.current !== ticket) return;
      setConfigured(status.configured);
      setKey('');
      setFeedback(
        t(status.configured ? 'Ключ Last.fm сохранён на этом компьютере.' : 'Ключ Last.fm удалён.'),
      );
    } catch {
      if (generation.current === ticket)
        setFeedback(t('Не удалось сохранить ключ Last.fm. Проверьте ключ и доступ к диску.'));
    } finally {
      if (generation.current === ticket) setBusy(false);
    }
  };
  return {
    configured,
    key,
    setKey,
    busy,
    feedback,
    save,
    valid: /^[a-f0-9]{32}$/i.test(key.trim()),
  };
}
