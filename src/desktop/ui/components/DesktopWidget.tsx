import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useEffect, useState, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Heart, X, Volume2, VolumeX, Disc } from 'lucide-react';
import { WidgetState } from '../../../shared/types';
import { DEFAULT_COVER_SVG_DATA_URI } from '../../../shared/utils/placeholder';

export const DesktopWidget: React.FC = () => {
  useLocale();
  const [state, setState] = useState<WidgetState>({
    track: null,
    isPlaying: false,
    currentTime: 0,
    duration: 180,
    isLiked: false,
    volume: 1,
  });

  const [interpolatedTime, setInterpolatedTime] = useState<number>(0);
  const baseTimeRef = React.useRef<{ time: number; timestamp: number }>({
    time: 0,
    timestamp: Date.now(),
  });
  const [showVolumePopup, setShowVolumePopup] = useState(false);

  useEffect(() => {
    // Ensure transparent document background for frameless desktop widget
    document.documentElement.style.background = 'transparent';
    document.body.style.background = 'transparent';
    document.body.style.overflow = 'hidden';

    if (window.electronAPI?.onWidgetStateUpdate) {
      const cleanup = window.electronAPI.onWidgetStateUpdate((newState) => {
        setState((prev) => ({ ...prev, ...newState }));
        if (typeof newState.currentTime === 'number') {
          baseTimeRef.current = { time: newState.currentTime, timestamp: Date.now() };
          setInterpolatedTime(newState.currentTime);
        }
      });
      // Immediately request state from main player window
      if (window.electronAPI?.sendWidgetCommand) {
        window.electronAPI.sendWidgetCommand('requestState');
      }
      return cleanup;
    }
  }, []);

  // Smooth local ticker when playing to avoid IPC flood
  useEffect(() => {
    if (!state.isPlaying) {
      setInterpolatedTime(state.currentTime);
      return;
    }
    const interval = setInterval(() => {
      const elapsed = (Date.now() - baseTimeRef.current.timestamp) / 1000;
      const cur = Math.min(state.duration, baseTimeRef.current.time + elapsed);
      setInterpolatedTime(cur);
    }, 250);
    return () => clearInterval(interval);
  }, [state.isPlaying, state.duration, state.currentTime]);

  const sendCommand = useCallback((command: string, data?: any) => {
    if (window.electronAPI?.sendWidgetCommand) {
      window.electronAPI.sendWidgetCommand(command, data);
    }
  }, []);

  const handleClose = () => {
    window.electronAPI?.toggleWidget?.();
  };

  // Scroll wheel on widget smoothly adjusts volume
  const handleWheel = (e: React.WheelEvent) => {
    const currentVol = state.volume !== undefined ? state.volume : 1;
    const delta = e.deltaY < 0 ? 0.05 : -0.05;
    const newVol = Math.max(0, Math.min(1, currentVol + delta));
    setState((prev) => ({ ...prev, volume: newVol }));
    sendCommand('setVolume', newVol);
  };

  const track = state.track;
  const coverUrl =
    track?.album?.cover_medium ||
    track?.album?.cover_small ||
    track?.album?.cover ||
    DEFAULT_COVER_SVG_DATA_URI;

  const artistName =
    track?.artist?.name || (typeof track?.artist === 'string' ? track.artist : 'SoSo Music');

  const currentDisplayTime = state.isPlaying ? interpolatedTime : state.currentTime;
  const progressPercent =
    state.duration > 0
      ? Math.min(100, Math.max(0, (currentDisplayTime / state.duration) * 100))
      : 0;

  const currentVolume = state.volume !== undefined ? state.volume : 1;

  return (
    <div
      onWheel={handleWheel}
      className="w-full h-full p-2.5 flex flex-col justify-between select-none overflow-hidden rounded-3xl bg-zinc-950/92 backdrop-blur-2xl border border-white/20 shadow-2xl text-white ring-1 ring-black/60 relative group"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Top Track Info Row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0 flex-1">
          <div className="relative w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 bg-white/10 shadow-md ring-1 ring-white/20">
            <img
              src={coverUrl}
              alt={track?.title || 'Cover'}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
              }}
              className="w-full h-full object-cover"
            />
            {state.isPlaying && (
              <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                <Disc className="w-3.5 h-3.5 text-soso-brand animate-spin-slow opacity-80" />
              </div>
            )}
          </div>

          <div className="min-w-0 flex-1">
            <h3 className="text-xs font-black text-white truncate leading-tight tracking-tight">
              {track?.title || 'SoSo Music'}
            </h3>
            <p className="text-[10px] text-zinc-400 font-semibold truncate mt-0.5 leading-tight">
              {track ? artistName : t('Ожидание трека...')}
            </p>
          </div>
        </div>

        {/* Action Controls in Header */}
        <div
          className="flex items-center gap-0.5 flex-shrink-0"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* Volume Button / Slider Toggle */}
          <div className="relative">
            <button
              onClick={() => setShowVolumePopup((p) => !p)}
              className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
              title={t('Громкость: {0}% (Колесо мыши)', Math.round(currentVolume * 100))}
            >
              {currentVolume === 0 ? (
                <VolumeX className="w-3.5 h-3.5 text-rose-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5" />
              )}
            </button>

            {showVolumePopup && (
              <div className="absolute top-7 right-0 bg-zinc-900/95 border border-white/20 rounded-xl p-2 shadow-2xl z-50 flex items-center gap-1.5 backdrop-blur-xl">
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={currentVolume}
                  onChange={(e) => {
                    const vol = parseFloat(e.target.value);
                    setState((prev) => ({ ...prev, volume: vol }));
                    sendCommand('setVolume', vol);
                  }}
                  className="w-20 h-1.5 accent-soso-brand bg-white/20 rounded-full cursor-pointer"
                />
                <span className="text-[9px] font-mono text-zinc-400 w-6 text-right font-bold">
                  {Math.round(currentVolume * 100)}%
                </span>
              </div>
            )}
          </div>

          {track && (
            <button
              onClick={() => sendCommand('toggleLike')}
              className={`p-1 rounded-lg transition-colors ${
                state.isLiked ? 'text-rose-500' : 'text-zinc-400 hover:text-white hover:bg-white/10'
              }`}
              title={state.isLiked ? t('Удалить из любимых') : t('Добавить в любимые')}
            >
              <Heart className={`w-3.5 h-3.5 ${state.isLiked ? 'fill-current' : ''}`} />
            </button>
          )}

          <button
            onClick={handleClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
            title={t('Закрыть виджет')}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Bottom Controls & Progress Bar */}
      <div
        className="flex items-center justify-between gap-2.5 pt-1"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Playback Buttons */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => sendCommand('prev')}
            className="p-1 text-zinc-400 hover:text-white transition-colors active:scale-90"
            title={t('Предыдущий трек')}
          >
            <SkipBack className="w-3.5 h-3.5 fill-current" />
          </button>

          <button
            onClick={() => sendCommand('togglePlay')}
            className="w-6 h-6 rounded-full bg-soso-brand text-black flex items-center justify-center hover:scale-105 active:scale-95 transition-transform shadow-md shadow-soso-brand/20"
            title={state.isPlaying ? t('Пауза') : t('Воспроизведение')}
          >
            {state.isPlaying ? (
              <Pause className="w-3 h-3 fill-current" />
            ) : (
              <Play className="w-3 h-3 fill-current ml-0.5" />
            )}
          </button>

          <button
            onClick={() => sendCommand('next')}
            className="p-1 text-zinc-400 hover:text-white transition-colors active:scale-90"
            title={t('Следующий трек')}
          >
            <SkipForward className="w-3.5 h-3.5 fill-current" />
          </button>
        </div>

        {/* Mini Click-to-Seek Progress Bar */}
        <div
          className="flex-1 h-1.5 bg-white/15 rounded-full overflow-hidden cursor-pointer relative group/bar"
          onClick={(e) => {
            if (!state.duration) return;
            const rect = e.currentTarget.getBoundingClientRect();
            const clickX = e.clientX - rect.left;
            const fraction = Math.max(0, Math.min(1, clickX / rect.width));
            const targetTime = fraction * state.duration;
            sendCommand('seek', targetTime);
          }}
        >
          <div
            className="h-full bg-soso-brand group-hover/bar:bg-soso-brand-light transition-all rounded-full"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Time Readout */}
        <div className="text-[9px] font-mono text-zinc-400 font-semibold flex-shrink-0">
          {Math.floor(state.currentTime / 60)}:
          {String(Math.floor(state.currentTime % 60)).padStart(2, '0')}
        </div>
      </div>
    </div>
  );
};
