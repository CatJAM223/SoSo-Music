import { t } from '../../../shared/i18n/locale';
import { useEffect, useState } from 'react';
import type { YouTubeAccountStatus } from '../../../shared/types';

export function useYouTubeAccountSettings(isOpen: boolean) {
  const [youtubeAccount, setYoutubeAccount] = useState<YouTubeAccountStatus>({
    connected: false,
    loginOpen: false,
  });
  const [youtubeAccountBusy, setYoutubeAccountBusy] = useState(false);
  const [youtubeAccountFeedback, setYoutubeAccountFeedback] = useState('');

  useEffect(() => {
    if (!isOpen || !window.electronAPI?.getYouTubeAccountStatus) return;
    let active = true;
    void window.electronAPI
      .getYouTubeAccountStatus()
      .then((status) => {
        if (active) setYoutubeAccount(status);
      })
      .catch(() => {
        if (active) setYoutubeAccountFeedback(t('Не удалось проверить подключение YouTube.'));
      });
    const unsubscribe = window.electronAPI.onYouTubeAccountChanged?.((status) => {
      if (active) setYoutubeAccount(status);
    });
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [isOpen]);

  const handleYouTubeAccount = async (action: 'connect' | 'refresh' | 'import' | 'disconnect') => {
    if (youtubeAccountBusy) return;
    setYoutubeAccountBusy(true);
    setYoutubeAccountFeedback('');
    try {
      const api = window.electronAPI;
      const method =
        action === 'connect'
          ? api?.connectYouTubeAccount
          : action === 'refresh'
            ? api?.refreshYouTubeSession
            : action === 'import'
              ? api?.importYouTubeSession
              : api?.disconnectYouTubeAccount;
      if (!method) throw new Error(t('Подключение YouTube доступно в приложении для ПК.'));
      const status = await method();
      setYoutubeAccount(status);
      if (action === 'refresh' && status.connected && !status.error)
        setYoutubeAccountFeedback(t('Кэш сессии обновлён. Повторите запуск трека.'));
    } catch {
      setYoutubeAccountFeedback(t('Не удалось изменить подключение YouTube. Попробуйте ещё раз.'));
    } finally {
      setYoutubeAccountBusy(false);
    }
  };

  return { youtubeAccount, youtubeAccountBusy, youtubeAccountFeedback, handleYouTubeAccount };
}
