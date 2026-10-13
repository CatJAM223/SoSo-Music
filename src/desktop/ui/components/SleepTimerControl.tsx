import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useEffect, useRef, useState } from 'react';
import { Moon, Check } from 'lucide-react';
import { useAudioControls, useAudioState } from '../../../shared/context/AudioContext';
import type { SleepTimerMode } from '../../../shared/hooks/useSleepTimer';

const OPTIONS: { mode: SleepTimerMode; label: string }[] = [
  { mode: 'off', label: 'Выключен' },
  { mode: '15', label: '15 минут' },
  { mode: '30', label: '30 минут' },
  { mode: '45', label: '45 минут' },
  { mode: '60', label: '1 час' },
  { mode: 'end_of_track', label: 'В конце трека' },
];

export function SleepTimerControl() {
  useLocale();
  const { sleepTimerMode, sleepTimerRemaining } = useAudioState();
  const { setSleepTimer } = useAudioControls();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  const active = sleepTimerMode !== 'off';
  const remaining =
    sleepTimerRemaining === null
      ? t('В конце трека')
      : t('{0} мин', Math.ceil(sleepTimerRemaining / 60));
  return (
    <div ref={root} className="relative">
      <button
        ref={trigger}
        type="button"
        aria-label={t('Таймер сна{0}', active ? `: ${remaining}` : '')}
        title={t('Таймер сна{0}', active ? `: ${remaining}` : '')}
        aria-expanded={open}
        aria-controls="player-sleep-timer"
        onClick={() => setOpen((value) => !value)}
        className={`relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${active ? 'text-soso-brand bg-soso-brand/15' : 'text-slate-600 dark:text-zinc-400 hover:bg-slate-100 dark:hover:bg-zinc-800'}`}
      >
        <Moon className="h-5 w-5" />
        {active && (
          <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-soso-brand" />
        )}
      </button>
      {open && (
        <div
          id="player-sleep-timer"
          className="absolute bottom-full right-0 mb-3 w-56 rounded-2xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 shadow-2xl"
        >
          <p className="px-3 pt-2 pb-1 text-sm font-bold text-slate-900 dark:text-white">
            {t('Таймер сна')}
          </p>
          {active && (
            <p className="px-3 pb-2 text-xs text-soso-brand">
              {sleepTimerRemaining === null ? remaining : t('Осталось {0}', remaining)}
            </p>
          )}
          {OPTIONS.map((option) => (
            <button
              key={option.mode}
              type="button"
              aria-pressed={sleepTimerMode === option.mode}
              onClick={() => {
                setSleepTimer(option.mode);
                setOpen(false);
                trigger.current?.focus();
              }}
              className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-slate-700 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800"
            >
              {t(option.label)}
              {sleepTimerMode === option.mode && <Check className="h-4 w-4 text-soso-brand" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
