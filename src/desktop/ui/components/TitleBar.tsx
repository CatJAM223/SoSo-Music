import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useState, useEffect } from 'react';
import { Minus, Square, Copy, X, ChevronLeft, ChevronRight } from 'lucide-react';

const PAGE_LABELS: Record<string, string> = {
  discover: 'Главная',
  search: 'Поиск',
  charts: 'Топ чарты',
  genres: 'Жанры',
  liked: 'Моя музыка',
  'my-music': 'Моя музыка',
  artist: 'Исполнитель',
  album: 'Альбом',
};

interface TitleBarProps {
  canGoBack?: boolean;
  canGoForward?: boolean;
  onGoBack?: () => void;
  onGoForward?: () => void;
  currentView?: string;
  currentPageLabel?: string;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  canGoBack = false,
  canGoForward = false,
  onGoBack,
  onGoForward,
  currentView,
  currentPageLabel,
}) => {
  useLocale();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      if (window.electronAPI?.isWindowMaximized) {
        const max = await window.electronAPI.isWindowMaximized();
        setIsMaximized(max);
      }
    };
    checkMaximized();
  }, []);

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleMaximize = async () => {
    if (window.electronAPI?.maximizeWindow) {
      const state = await window.electronAPI.maximizeWindow();
      setIsMaximized(state);
    }
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <header
      className="h-11 w-full flex items-center justify-between px-6 md:px-8 select-none z-30 transition-colors duration-200 border-b border-slate-200/70 dark:border-white/[0.05] bg-transparent shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left Navigation Arrows (Aligned with main content left margin) */}
      <div
        className="flex items-center gap-1 h-full -ml-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          onClick={onGoBack}
          disabled={!canGoBack}
          title={t('Назад (Боковая кнопка мыши 4 / Alt+Left)')}
          className="p-1.5 rounded-full text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition-all active:scale-90"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button
          onClick={onGoForward}
          disabled={!canGoForward}
          title={t('Вперёд (Боковая кнопка мыши 5 / Alt+Right)')}
          className="p-1.5 rounded-full text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white disabled:opacity-25 disabled:cursor-not-allowed hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition-all active:scale-90"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Center: Current Page Label */}
      <div className="flex-1 h-full flex items-center justify-center pointer-events-none select-none">
        {(currentPageLabel || (currentView && PAGE_LABELS[currentView])) && (
          <span className="text-[12px] font-semibold text-slate-500 dark:text-zinc-400 tracking-tight">
            {currentPageLabel || t(PAGE_LABELS[currentView!])}
          </span>
        )}
      </div>

      {/* Right: Window Action Buttons */}
      <div
        className="flex items-center h-full -mr-6 md:-mr-8"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          title={t('Свернуть')}
          className="h-full px-3.5 flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition-colors"
        >
          <Minus className="w-3.5 h-3.5" />
        </button>

        {/* Maximize / Restore */}
        <button
          onClick={handleMaximize}
          title={isMaximized ? t('Восстановить') : t('Развернуть')}
          className="h-full px-3.5 flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition-colors"
        >
          {isMaximized ? <Copy className="w-3.5 h-3.5" /> : <Square className="w-3 h-3" />}
        </button>

        {/* Close (hides to tray) */}
        <button
          onClick={handleClose}
          title={t('Закрыть (в трей)')}
          className="h-full px-4 flex items-center justify-center text-slate-500 dark:text-zinc-400 hover:text-white hover:bg-rose-600 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
};
