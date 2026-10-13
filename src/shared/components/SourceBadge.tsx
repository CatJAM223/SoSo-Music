import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import React from 'react';

export interface SourceBadgeProps {
  source: 'soundcloud' | 'youtube' | 'deezer' | string;
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export const SourceBadge: React.FC<SourceBadgeProps> = ({
  source,
  size = 'sm',
  showText = false,
  className = '',
}) => {
  useLocale();
  if (showText) {
    if (source === 'youtube') {
      return (
        <span
          title={t('Источник: YouTube Music')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-rose-600/15 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs shadow-sm select-none flex-shrink-0 ${className}`}
        >
          <span className="w-3.5 h-3.5 rounded bg-rose-600 text-white font-black text-[9px] flex items-center justify-center">
            Y
          </span>
          <span>YouTube Music</span>
        </span>
      );
    }

    if (source === 'deezer') {
      return (
        <span
          title={t('Старый импорт')}
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-zinc-500/15 border border-zinc-500/30 text-zinc-600 dark:text-zinc-400 text-xs shadow-sm select-none flex-shrink-0 ${className}`}
        >
          <span className="w-3.5 h-3.5 rounded bg-zinc-600 text-white font-black text-[9px] flex items-center justify-center">
            I
          </span>
          <span>{t('Импорт')}</span>
        </span>
      );
    }

    return (
      <span
        title={t('Источник: SoundCloud')}
        className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full font-bold bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 text-xs shadow-sm select-none flex-shrink-0 ${className}`}
      >
        <span className="w-3.5 h-3.5 rounded bg-amber-500 text-black font-black text-[9px] flex items-center justify-center">
          S
        </span>
        <span>SoundCloud</span>
      </span>
    );
  }

  const sizeClasses =
    size === 'sm' ? 'w-4 h-4 text-[10px]' : size === 'md' ? 'w-5 h-5 text-xs' : 'w-6 h-6 text-sm';

  if (source === 'youtube') {
    return (
      <span
        title={t('Источник: YouTube Music')}
        className={`inline-flex items-center justify-center font-black rounded select-none flex-shrink-0 shadow-sm bg-rose-600 text-white leading-none ${sizeClasses} ${className}`}
      >
        Y
      </span>
    );
  }

  if (source === 'deezer') {
    return (
      <span
        title={t('Старый импорт')}
        className={`inline-flex items-center justify-center font-black rounded select-none flex-shrink-0 shadow-sm bg-zinc-600 text-white leading-none ${sizeClasses} ${className}`}
      >
        I
      </span>
    );
  }

  return (
    <span
      title={t('Источник: SoundCloud')}
      className={`inline-flex items-center justify-center font-black rounded select-none flex-shrink-0 shadow-sm bg-amber-500 text-black leading-none ${sizeClasses} ${className}`}
    >
      S
    </span>
  );
};
