import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import React from 'react';
import { WifiOff, Clock3, Pause, RotateCw } from 'lucide-react';
import type { StreamResolveFailure } from '../utils/streamResolveError';

type Props = {
  issue: { kind: StreamResolveFailure; autoResume: boolean } | null;
  onRetry: () => void;
  onPause: () => void;
};
export const PlaybackIssueNotice: React.FC<Props> = ({ issue, onRetry, onPause }) => {
  useLocale();
  const [offline, setOffline] = React.useState(() => navigator.onLine === false);
  React.useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  if (!issue && !offline) return null;
  const network = offline || issue?.kind === 'network';
  const title = offline
    ? t('Нет подключения к интернету')
    : network
      ? t('Нет связи с музыкальным сервисом')
      : issue?.kind === 'rate-limit'
        ? t('Сервис просит подождать')
        : t('Музыкальный сервис не отвечает');
  const Icon = network ? WifiOff : Clock3;
  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[110] bottom-[calc(88px+env(safe-area-inset-bottom,0px))] sm:bottom-28 left-1/2 -translate-x-1/2 w-[calc(100%-2rem)] max-w-md rounded-2xl border border-white/15 bg-[#191a1d] text-white shadow-xl p-4"
    >
      <div className="flex gap-3 items-start">
        <Icon className="w-5 h-5 shrink-0 text-[#e8b900] mt-0.5" />
        <div className="min-w-0">
          <p className="font-semibold text-sm">{title}</p>
          <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
            {issue ? (
              <>
                {t('Трек и позиция сохранены.')}{' '}
                {issue.autoResume
                  ? offline
                    ? t('Продолжим автоматически, когда появится интернет.')
                    : t('Автоматически повторяем загрузку — нажимать «Повторить» не нужно.')
                  : t('Продолжите прослушивание, когда будет удобно.')}
              </>
            ) : (
              t('Скачанные треки доступны. Для поиска и новых потоков нужно подключение.')
            )}
          </p>
        </div>
      </div>
      {issue && (
        <div className="flex items-center justify-end gap-3 mt-3">
          {issue.autoResume && (
            <button
              type="button"
              onClick={onPause}
              className="text-xs text-zinc-400 hover:text-white inline-flex items-center gap-1.5 py-2"
            >
              <Pause size={14} />
              {t('Остановить ожидание')}
            </button>
          )}
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg px-3 py-2 bg-[#e8b900] text-black font-semibold text-xs inline-flex items-center gap-1.5"
          >
            <RotateCw size={14} />
            {t('Повторить')}
          </button>
        </div>
      )}
    </div>
  );
};
