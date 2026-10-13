import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React, { useState, useRef } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Repeat1,
  Volume2,
  VolumeX,
  Volume1,
  ListMusic,
  ThumbsDown,
  Headphones,
  Loader2,
  Mic2,
  Disc,
  Guitar,
  Plus,
} from 'lucide-react';
import {
  useAudioState,
  useAudioControls,
  useAudioProgress,
} from '../../../shared/context/AudioContext';
import { advanceTrackArtwork } from '../../../shared/utils/trackArtwork';
import { formatTime, detectTrackSource, resolveTrackCover } from '../../../shared/utils/formatters';
import { parseArtists } from '../../../shared/utils/artistParser';
import { bufferedPercentRanges } from '../../../shared/utils/audioBuffer';
import { useLyricsAvailability } from '../../../shared/hooks/useLyricsAvailability';
import { SourceBadge } from './SourceBadge';
import { SleepTimerControl } from './SleepTimerControl';
import { AnimatedLikeButton } from '../../../shared/components/BrokenHeartEffect';
import appLogo from '../../../renderer/assets/icon.png';

import { isPlayButtonDisabled } from '../../../shared/utils/playerGuards';
export { isPlayButtonDisabled };

interface PlayerBarProps {
  onToggleQueue: () => void;
  isQueueOpen: boolean;
  onToggleLyrics?: () => void;
  isLyricsOpen?: boolean;
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
  onOpenMobilePlayer?: () => void;
  onOpenAddToPlaylist?: (track: import('../../../shared/types').Track) => void;
}

const PlayerProgressBar: React.FC<{ fallbackDuration?: number; isActive: boolean }> = React.memo(
  ({ fallbackDuration, isActive }) => {
    useLocale();
    const { currentTime, duration, bufferedRanges = [] } = useAudioProgress();
    const { seek } = useAudioControls();
    const [isSeeking, setIsSeeking] = useState(false);
    const [seekValue, setSeekValue] = useState(0);
    const seekBarRef = useRef<HTMLDivElement>(null);

    const currentDisplayTime = isActive ? (isSeeking ? seekValue : currentTime) : 0;
    const effectiveDuration = isActive ? (duration > 0 ? duration : fallbackDuration || 180) : 0;
    const progressPercent =
      effectiveDuration > 0
        ? Math.min(100, Math.max(0, (currentDisplayTime / effectiveDuration) * 100))
        : 0;

    const handleSeekPointerUpdate = (
      e: React.PointerEvent<HTMLDivElement>,
      isFinal: boolean = false,
    ) => {
      if (!isActive || !seekBarRef.current) return;
      const rect = seekBarRef.current.getBoundingClientRect();
      if (rect.width <= 0) return;
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const targetSeconds = frac * effectiveDuration;
      setSeekValue(targetSeconds);

      if (isFinal) {
        seek(targetSeconds);
        setIsSeeking(false);
      }
    };

    const handleSeekPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isActive) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      setIsSeeking(true);
      handleSeekPointerUpdate(e, false);
    };

    const handleSeekPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (isSeeking) {
        handleSeekPointerUpdate(e, false);
      }
    };

    const handleSeekPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isActive) return;
      handleSeekPointerUpdate(e, true);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    };

    const handleSeekPointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
      setIsSeeking(false);
      if (e.currentTarget.hasPointerCapture(e.pointerId))
        e.currentTarget.releasePointerCapture(e.pointerId);
    };

    const handleSeekKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isActive) return;
      const base = isSeeking ? seekValue : currentTime;
      const target =
        e.key === 'Home'
          ? 0
          : e.key === 'End'
            ? effectiveDuration
            : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
              ? base - 5
              : e.key === 'ArrowRight' || e.key === 'ArrowUp'
                ? base + 5
                : null;
      if (target === null) return;
      e.preventDefault();
      seek(Math.max(0, Math.min(effectiveDuration, target)));
    };

    return (
      <div className="w-full flex items-center gap-3 text-xs text-slate-600 dark:text-zinc-400 font-sans tabular-nums">
        <span className="w-10 text-right select-none font-medium">
          {formatTime(currentDisplayTime)}
        </span>

        <div
          ref={seekBarRef}
          onPointerDown={handleSeekPointerDown}
          onPointerMove={handleSeekPointerMove}
          onPointerUp={handleSeekPointerUp}
          onPointerCancel={handleSeekPointerCancel}
          onKeyDown={handleSeekKeyDown}
          role="slider"
          tabIndex={isActive ? 0 : -1}
          aria-label={t('Позиция воспроизведения')}
          aria-disabled={!isActive}
          aria-valuemin={0}
          aria-valuemax={effectiveDuration}
          aria-valuenow={Math.round(currentDisplayTime)}
          aria-valuetext={t(
            '{0} из {1}',
            formatTime(currentDisplayTime),
            formatTime(effectiveDuration),
          )}
          className={`relative flex-1 group flex items-center h-5 touch-none select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-soso-brand rounded-full ${isActive ? 'cursor-pointer' : 'cursor-default opacity-60'}`}
        >
          <div className="relative w-full h-1.5 bg-slate-200 dark:bg-zinc-700/80 rounded-full overflow-hidden group-hover:h-2 transition-all shadow-inner pointer-events-none">
            {bufferedPercentRanges(isActive ? bufferedRanges : [], effectiveDuration).map(
              (range) => (
                <div
                  key={range.start}
                  aria-hidden="true"
                  data-audio-buffer-range
                  className="absolute inset-y-0 bg-slate-400/50 dark:bg-white/25"
                  style={{ left: range.start + '%', width: range.end - range.start + '%' }}
                />
              ),
            )}
            <div
              className="relative z-[1] h-full bg-soso-brand rounded-full shadow-sm"
              style={{ width: `${progressPercent}%` }}
            />
          </div>

          <div
            className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white border-2 border-soso-brand rounded-full shadow-md pointer-events-none transition-transform ${
              isSeeking ? 'opacity-100 scale-125' : 'opacity-0 group-hover:opacity-100'
            }`}
            style={{ left: `calc(${progressPercent}% - 7px)` }}
          />
        </div>

        <span className="w-10 select-none font-medium">{formatTime(effectiveDuration)}</span>
      </div>
    );
  },
);

const PlayerMiniProgressBar: React.FC<{ fallbackDuration?: number; isActive: boolean }> =
  React.memo(({ fallbackDuration, isActive }) => {
    useLocale();
    const { currentTime, duration, bufferedRanges = [] } = useAudioProgress();
    const effectiveDuration = isActive ? (duration > 0 ? duration : fallbackDuration || 180) : 0;
    const progressPercent =
      effectiveDuration > 0
        ? Math.min(100, Math.max(0, (currentTime / effectiveDuration) * 100))
        : 0;

    return (
      <div className="absolute top-0 left-3 right-3 h-[2.5px] bg-slate-200 dark:bg-white/10 rounded-full overflow-hidden">
        {bufferedPercentRanges(isActive ? bufferedRanges : [], effectiveDuration).map((range) => (
          <div
            key={range.start}
            aria-hidden="true"
            data-audio-buffer-range
            className="absolute inset-y-0 bg-slate-400/50 dark:bg-white/25"
            style={{ left: range.start + '%', width: range.end - range.start + '%' }}
          />
        ))}
        <div
          className="relative z-[1] h-full bg-soso-brand transition-[width] duration-200 ease-linear rounded-full"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    );
  });

export const PlayerBar: React.FC<PlayerBarProps> = ({
  onToggleQueue,
  isQueueOpen,
  onToggleLyrics,
  isLyricsOpen,
  onNavigateToArtist,
  onOpenMobilePlayer,
  onOpenAddToPlaylist,
}) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  const {
    currentTrack,
    isPlaying,
    isWaveActive,
    isLoadingTrack,
    volume,
    isMuted,
    repeatMode,
    isShuffle,
    queue,
    snippetTrack,
    isSnippetPlaying,
    likedTrackIds,
  } = useAudioState();

  const {
    togglePlay,
    setVolume,
    toggleMute,
    nextTrack,
    prevTrack,
    cycleRepeatMode,
    toggleShuffle,
    toggleLike,
    dislikeTrack,
    undislikeTrack,
    isTrackDisliked,
  } = useAudioControls();

  const {
    hasLyrics,
    hasChords,
    isLoading: isLyricsLoading,
  } = useLyricsAvailability(snippetTrack ? null : currentTrack, currentTrack?.duration);

  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const [volumeHoverPercent, setVolumeHoverPercent] = useState<number | null>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);

  const activeTrack = isSnippetPlaying ? snippetTrack : currentTrack;
  const isLiked = activeTrack ? likedTrackIds.has(String(activeTrack.id)) : false;
  const isDisliked = activeTrack ? isTrackDisliked(activeTrack.id) : false;

  const effectiveVolume = isMuted ? 0 : volume;
  const volumePercent = Math.min(100, Math.max(0, effectiveVolume * 100));

  // --- Pixel-Perfect Pointer Handlers for Volume ---
  const handleVolumePointerUpdate = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!volumeBarRef.current) return;
    const rect = volumeBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setVolume(frac);
  };

  const handleVolumePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDraggingVolume(true);
    handleVolumePointerUpdate(e);
  };

  const handleVolumePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setVolumeHoverPercent(
      Math.round(Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width))) * 100),
    );
    if (isDraggingVolume) {
      handleVolumePointerUpdate(e);
    }
  };

  const handleVolumePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingVolume(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const handleVolumePointerCancel = (e: React.PointerEvent<HTMLDivElement>) => {
    setIsDraggingVolume(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const coverUrl = resolveTrackCover(activeTrack, '');

  const VolumeIcon = isMuted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

  return (
    <>
      {/* Desktop Player Bar (Visible only on md+) */}
      <footer
        data-tour="player-bar"
        className="soso-player-bar hidden md:flex h-24 bg-white/90 dark:bg-[#0a0a0d]/90 backdrop-blur-2xl border-t border-slate-200/70 dark:border-white/[0.05] px-6 items-center justify-between z-30 select-none transition-colors duration-200 shadow-2xl animate-slide-up"
      >
        {/* Left Column: Track Details (Expanded to prevent early truncation) */}
        <div
          {...youtubeDisabledProps(activeTrack, youtubeDisabled)}
          className="flex items-center gap-4 flex-1 min-w-[280px] max-w-sm lg:max-w-md xl:max-w-lg"
        >
          {activeTrack ? (
            <>
              <div className="relative w-14 h-14 rounded-md overflow-hidden flex-shrink-0 bg-gradient-to-br from-zinc-700 to-zinc-900 shadow-md flex items-center justify-center">
                {coverUrl ? (
                  <img
                    key={String(activeTrack.id) + ':' + coverUrl}
                    src={coverUrl}
                    alt={activeTrack.title}
                    onError={(event) => advanceTrackArtwork(event.currentTarget, activeTrack)}
                    className="w-full h-full object-cover soso-art-enter"
                  />
                ) : null}
                <Disc className="w-7 h-7 text-zinc-400 absolute -z-10" />
                {isSnippetPlaying && (
                  <div className="absolute inset-0 bg-purple-900/70 flex items-center justify-center">
                    <Headphones className="w-6 h-6 text-purple-200 animate-pulse" />
                  </div>
                )}
              </div>

              <div key={String(activeTrack.id)} className="min-w-0 flex-1 soso-track-enter">
                <div className="flex items-center gap-2">
                  <p
                    className="text-sm font-bold text-slate-900 dark:text-white truncate"
                    title={activeTrack.title}
                  >
                    {activeTrack.title}
                  </p>
                  {isSnippetPlaying && (
                    <span className="bg-purple-600/90 text-[10px] text-white font-bold px-2 py-0.5 rounded-full tracking-wider flex-shrink-0 shadow-sm">
                      {t('СНИППЕТ')}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 min-w-0">
                  <SourceBadge source={detectTrackSource(activeTrack)} size="sm" />
                  <div className="text-xs font-medium text-slate-600 dark:text-zinc-400 truncate flex items-center gap-1">
                    {(() => {
                      const rawArtist =
                        activeTrack.artist?.name ||
                        (typeof activeTrack.artist === 'string'
                          ? activeTrack.artist
                          : 'Unknown Artist');
                      const parsed = parseArtists(rawArtist, activeTrack.title);
                      if (parsed.length <= 1) {
                        return (
                          <span
                            onClick={() => {
                              if (
                                onNavigateToArtist &&
                                rawArtist &&
                                rawArtist !== 'Unknown Artist'
                              ) {
                                const source =
                                  activeTrack.artist?.source ||
                                  activeTrack.source ||
                                  detectTrackSource(activeTrack);
                                const rawTrackId = String(activeTrack.id || '');
                                const isNumericScId =
                                  activeTrack.artist?.id &&
                                  String(activeTrack.artist.id).match(/^sc_art_\d+$/);
                                const artistId =
                                  activeTrack.artist?.id && !isNumericScId
                                    ? activeTrack.artist.id
                                    : rawTrackId.startsWith('sc_') || source === 'soundcloud'
                                      ? `sc_art_${rawArtist.toLowerCase().replace(/\s+/g, '_')}`
                                      : rawTrackId.startsWith('yt_') || source === 'youtube'
                                        ? `yt_art_${rawArtist.toLowerCase().replace(/\s+/g, '_')}`
                                        : activeTrack.artist?.id;
                                onNavigateToArtist({ id: artistId, name: rawArtist });
                              }
                            }}
                            className={
                              onNavigateToArtist
                                ? 'hover:underline cursor-pointer hover:text-slate-900 dark:hover:text-white'
                                : ''
                            }
                          >
                            {rawArtist}
                          </span>
                        );
                      }
                      return parsed.map((art, idx) => (
                        <React.Fragment key={art.name + idx}>
                          <span
                            onClick={() => {
                              if (onNavigateToArtist) {
                                const source =
                                  activeTrack.artist?.source ||
                                  activeTrack.source ||
                                  detectTrackSource(activeTrack);
                                const rawTrackId = String(activeTrack.id || '');
                                const artistId =
                                  rawTrackId.startsWith('sc_') || source === 'soundcloud'
                                    ? `sc_art_${art.name.toLowerCase().replace(/\s+/g, '_')}`
                                    : rawTrackId.startsWith('yt_') || source === 'youtube'
                                      ? `yt_art_${art.name.toLowerCase().replace(/\s+/g, '_')}`
                                      : undefined;
                                onNavigateToArtist({ id: artistId, name: art.name });
                              }
                            }}
                            className="hover:underline cursor-pointer hover:text-slate-900 dark:hover:text-white"
                          >
                            {art.name}
                          </span>
                          {idx < parsed.length - 1 && (
                            <span className="text-slate-400 dark:text-zinc-500">, </span>
                          )}
                        </React.Fragment>
                      ));
                    })()}
                    {activeTrack.album?.title &&
                      activeTrack.album.title !== 'Single' &&
                      activeTrack.album.title !== activeTrack.title && (
                        <span
                          className="hidden lg:inline text-slate-400/80 dark:text-zinc-500 truncate font-normal"
                          title={activeTrack.album.title}
                        >
                          · {activeTrack.album.title}
                        </span>
                      )}
                  </div>
                </div>
              </div>

              {/* Action Buttons: Like & Dislike */}
              <div className="flex items-center gap-0.5 flex-shrink-0 ml-1">
                {/* Heart Like Button */}
                <AnimatedLikeButton
                  isLiked={isLiked}
                  onToggle={() => activeTrack && toggleLike(activeTrack)}
                  iconClassName="w-5 h-5"
                  className={
                    isLiked
                      ? 'text-rose-500 hover:text-rose-400'
                      : 'text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800/60'
                  }
                />

                {/* Dislike / Skip & Block Button */}
                <button
                  onClick={() =>
                    activeTrack &&
                    (isDisliked ? undislikeTrack(activeTrack.id) : dislikeTrack(activeTrack))
                  }
                  title={
                    isDisliked
                      ? t('Убрать отметку «Не нравится»')
                      : t('Не нравится (Пропустить и не рекомендовать)')
                  }
                  className={`p-2 rounded-xl transition-all duration-150 active:scale-95 flex-shrink-0 ${
                    isDisliked
                      ? 'text-amber-500 hover:text-amber-400'
                      : 'text-slate-400/70 dark:text-zinc-500 hover:text-rose-500 dark:hover:text-rose-400 hover:bg-slate-100 dark:hover:bg-zinc-800/60'
                  }`}
                >
                  <ThumbsDown className={`w-5 h-5 ${isDisliked ? 'fill-current' : ''}`} />
                </button>
                {onOpenAddToPlaylist && (
                  <button
                    type="button"
                    onClick={() => activeTrack && onOpenAddToPlaylist(activeTrack)}
                    aria-label={t('Добавить в плейлист')}
                    title={t('Добавить в плейлист')}
                    className="p-2 rounded-xl transition-all duration-150 active:scale-95 flex-shrink-0 text-slate-400 dark:text-zinc-400 hover:text-soso-brand hover:bg-slate-100 dark:hover:bg-zinc-800/60"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-zinc-500">
              <div className="w-14 h-14 rounded-xl overflow-hidden bg-slate-100 dark:bg-zinc-800/40 flex items-center justify-center flex-shrink-0 border border-slate-200/50 dark:border-zinc-800/50">
                <img
                  src={appLogo}
                  alt="SoSo Music"
                  className="w-8 h-8 object-cover opacity-40 grayscale"
                />
              </div>
              <span>{t('Выберите трек для воспроизведения')}</span>
            </div>
          )}
        </div>

        {/* Center Column: Controls & Seekbar (Stretched to 3xl to balance empty space) */}
        <div className="flex flex-col items-center gap-2 flex-[2_1_0%] max-w-2xl lg:max-w-3xl min-w-[340px] mx-4">
          {/* Buttons Row */}
          <div className="flex items-center gap-5">
            {!isWaveActive && (
              <button
                onClick={toggleShuffle}
                aria-label={isShuffle ? t('Случайный порядок: ВКЛ') : t('Случайный порядок: ВЫКЛ')}
                className={`p-1.5 rounded-full transition-colors ${
                  isShuffle
                    ? 'text-soso-brand font-bold'
                    : 'text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Shuffle className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={prevTrack}
              disabled={queue.length === 0}
              aria-label={t('Предыдущий трек (P)')}
              className="text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SkipBack className="w-5 h-5 fill-current" />
            </button>
            <button
              {...youtubeDisabledProps(activeTrack, youtubeDisabled)}
              onClick={togglePlay}
              disabled={isPlayButtonDisabled(currentTrack, isSnippetPlaying, queue)}
              aria-busy={isLoadingTrack && !isSnippetPlaying}
              aria-label={
                isLoadingTrack && !isSnippetPlaying
                  ? t('Отменить загрузку')
                  : isPlaying
                    ? t('Пауза (Пробел)')
                    : t('Воспроизвести (Пробел)')
              }
              className={`w-11 h-11 rounded-full flex items-center justify-center transition-all duration-150 transform hover:scale-105 shadow-md ${
                isPlaying || isSnippetPlaying
                  ? 'bg-soso-brand text-black hover:bg-soso-brand-light shadow-soso-brand/30'
                  : 'bg-slate-900 dark:bg-white text-white dark:text-black hover:bg-slate-800 dark:hover:bg-zinc-200'
              } disabled:opacity-40 disabled:hover:scale-100`}
            >
              {isLoadingTrack ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : isPlaying || isSnippetPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>
            <button
              onClick={nextTrack}
              disabled={queue.length === 0}
              aria-label={t('Следующий трек (N)')}
              className="text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <SkipForward className="w-5 h-5 fill-current" />
            </button>
            {!isWaveActive && (
              <button
                onClick={cycleRepeatMode}
                aria-label={t(
                  'Повтор: {0}',
                  repeatMode === 'off' ? 'Выкл' : repeatMode === 'all' ? 'Все' : 'Один',
                )}
                className={`relative p-1.5 rounded-full transition-colors ${
                  repeatMode !== 'off'
                    ? 'text-soso-brand font-bold'
                    : 'text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {repeatMode === 'one' ? (
                  <Repeat1 className="w-4 h-4" />
                ) : (
                  <Repeat className="w-4 h-4" />
                )}
              </button>
            )}
          </div>

          {/* Timeline / Seekbar */}
          <PlayerProgressBar
            fallbackDuration={currentTrack?.duration}
            isActive={Boolean(currentTrack)}
          />
        </div>

        {/* Right Column: Volume & Queue */}
        <div className="flex flex-col items-end justify-center gap-2 flex-1 min-w-[220px] max-w-xs">
          {/* Top Row: Lyrics & Queue (aligned with transport buttons) */}
          <div className="flex items-center justify-end gap-2.5 h-11">
            <SleepTimerControl />

            {/* Dynamic Lyrics / Chords Modal Toggle (Always visible, glowing when available) */}
            {onToggleLyrics && (
              <button
                data-tour="lyrics-guitar"
                onClick={onToggleLyrics}
                aria-label={hasChords && !hasLyrics ? t('Аккорды') : t('Текст песни (Караоке)')}
                title={
                  hasLyrics && hasChords
                    ? t('Текст песни и аккорды (Караоке)')
                    : hasChords
                      ? t('Аккорды для гитары')
                      : hasLyrics
                        ? t('Текст песни (Караоке доступно)')
                        : isLyricsLoading
                          ? t('Поиск текста песни...')
                          : t('Текст песни (Караоке недоступно)')
                }
                className={`p-2 rounded-xl transition-all duration-200 ${
                  isLyricsOpen
                    ? hasChords && !hasLyrics
                      ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/40 shadow-sm'
                      : hasLyrics
                        ? 'bg-soso-brand/20 text-soso-brand ring-1 ring-soso-brand/40 shadow-sm drop-shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                        : 'bg-slate-200/80 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300'
                    : hasLyrics || hasChords
                      ? hasChords && !hasLyrics
                        ? 'text-amber-400 hover:bg-amber-500/15 drop-shadow-[0_0_6px_rgba(245,158,11,0.35)]'
                        : 'text-soso-brand hover:text-soso-brand-light hover:bg-soso-brand/15 drop-shadow-[0_0_8px_rgba(245,158,11,0.4)]'
                      : 'text-slate-400/40 dark:text-zinc-600 hover:text-slate-600 dark:hover:text-zinc-400 hover:bg-slate-100/60 dark:hover:bg-zinc-800/40'
                }`}
              >
                {hasChords && !hasLyrics ? (
                  <Guitar className="w-5 h-5 text-amber-400" />
                ) : (
                  <Mic2 className="w-5 h-5" />
                )}
              </button>
            )}

            {/* Queue Drawer Toggle */}
            <button
              onClick={onToggleQueue}
              aria-label={t('Очередь воспроизведения')}
              className={`relative p-2 rounded-xl transition-colors ${
                isQueueOpen
                  ? 'bg-soso-brand/20 text-soso-brand'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800'
              }`}
            >
              <ListMusic className="w-5 h-5" />
              {queue.length > 0 && (
                <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-soso-brand rounded-full ring-2 ring-white dark:ring-[#121212] transition-transform animate-scale-in" />
              )}
            </button>
          </div>

          {/* Bottom Row: Volume (aligned with the seekbar & time labels) */}
          <div className="flex items-center gap-2.5 group h-5">
            <button
              onClick={toggleMute}
              className="text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white transition-colors"
              title={isMuted ? t('Включить звук') : t('Выключить звук')}
            >
              <VolumeIcon className="w-5 h-5" />
            </button>

            {/* Wider Volume Slider (w-36) with Green Fill & Precision Pointer Tracking */}
            <div
              ref={volumeBarRef}
              role="slider"
              tabIndex={0}
              aria-label={t('Громкость')}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(volumePercent)}
              aria-valuetext={t('{0} процентов', Math.round(volumePercent))}
              onPointerEnter={handleVolumePointerMove}
              onPointerLeave={() => setVolumeHoverPercent(null)}
              onFocus={() => setVolumeHoverPercent(Math.round(volumePercent))}
              onBlur={() => setVolumeHoverPercent(null)}
              onKeyDown={(event) => {
                let next = effectiveVolume;
                if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next += 0.05;
                else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next -= 0.05;
                else if (event.key === 'Home') next = 0;
                else if (event.key === 'End') next = 1;
                else return;
                event.preventDefault();
                event.stopPropagation();
                setVolume(Math.max(0, Math.min(1, next)));
                setVolumeHoverPercent(Math.round(Math.max(0, Math.min(1, next)) * 100));
              }}
              onPointerDown={handleVolumePointerDown}
              onPointerMove={handleVolumePointerMove}
              onPointerUp={handleVolumePointerUp}
              onPointerCancel={handleVolumePointerCancel}
              className="relative w-36 group/vol flex items-center h-5 cursor-pointer touch-none select-none"
            >
              {(isDraggingVolume || volumeHoverPercent !== null) && (
                <output
                  className="absolute -top-8 z-50 -translate-x-1/2 rounded-lg border border-white/10 bg-zinc-950 px-2 py-1 text-[11px] font-bold tabular-nums text-white shadow-lg pointer-events-none"
                  style={{
                    left: `${Math.max(8, Math.min(92, isDraggingVolume ? volumePercent : (volumeHoverPercent ?? volumePercent)))}%`,
                  }}
                >
                  {Math.round(
                    isDraggingVolume ? volumePercent : (volumeHoverPercent ?? volumePercent),
                  )}
                  %
                </output>
              )}
              <div className="relative w-full h-1.5 bg-slate-200 dark:bg-zinc-700 rounded-full overflow-hidden group-hover/vol:h-2 transition-all shadow-inner pointer-events-none">
                <div
                  className="h-full bg-soso-brand rounded-full shadow-sm"
                  style={{ width: `${volumePercent}%` }}
                />
              </div>

              <div
                className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white border-2 border-soso-brand rounded-full shadow-md pointer-events-none transition-transform ${
                  isDraggingVolume
                    ? 'opacity-100 scale-125'
                    : 'opacity-0 group-hover/vol:opacity-100'
                }`}
                style={{ left: `calc(${volumePercent}% - 7px)` }}
              />
            </div>
          </div>
        </div>
      </footer>

      {/* Mobile Mini Track HUD Bar (Sticky above bottom navigation, visible on < md) */}
      {activeTrack && (
        <div
          onClick={onOpenMobilePlayer}
          className="md:hidden fixed bottom-[calc(4.25rem+env(safe-area-inset-bottom,0px))] left-3 right-3 z-30 flex items-center justify-between p-2 rounded-2xl bg-white/95 dark:bg-[#141418]/95 backdrop-blur-2xl border border-slate-200/90 dark:border-white/10 shadow-2xl transition-all select-none active:scale-[0.99] cursor-pointer animate-slide-up"
        >
          {/* Top Mini Progress Bar */}
          <PlayerMiniProgressBar
            fallbackDuration={currentTrack?.duration}
            isActive={Boolean(currentTrack)}
          />

          {/* Left: Artwork + Track Details */}
          <div className="flex items-center gap-3 min-w-0 flex-1 pr-2 pt-0.5">
            <div className="relative w-11 h-11 rounded-xl overflow-hidden flex-shrink-0 bg-gradient-to-br from-zinc-700 to-zinc-900 shadow ring-1 ring-black/5 dark:ring-white/10 flex items-center justify-center">
              {coverUrl ? (
                <img
                  key={String(activeTrack.id) + ':' + coverUrl}
                  src={coverUrl}
                  alt={activeTrack.title}
                  onError={(event) => advanceTrackArtwork(event.currentTarget, activeTrack)}
                  className="w-full h-full object-cover soso-art-enter"
                />
              ) : null}
              <Disc className="w-5 h-5 text-zinc-400 absolute -z-10" />
              {isSnippetPlaying && (
                <div className="absolute inset-0 bg-purple-900/70 flex items-center justify-center">
                  <Headphones className="w-5 h-5 text-purple-200 animate-pulse" />
                </div>
              )}
            </div>

            <div key={String(activeTrack.id)} className="min-w-0 flex-1 soso-track-enter">
              <div className="flex items-center gap-1.5">
                <p className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                  {activeTrack.title}
                </p>
                {isSnippetPlaying && (
                  <span className="bg-purple-600/90 text-[9px] text-white font-bold px-1.5 py-0.5 rounded-full tracking-wide flex-shrink-0">
                    {t('СНИППЕТ')}
                  </span>
                )}
              </div>
              <p className="text-[11px] font-medium text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                {activeTrack.artist?.name ||
                  (typeof activeTrack.artist === 'string' ? activeTrack.artist : t('Исполнитель'))}
              </p>
            </div>
          </div>

          {/* Right: Like + Play/Pause Controls */}
          <div className="flex items-center gap-1.5 flex-shrink-0 pt-0.5">
            {/* Heart Like Button */}
            <div onClick={(e) => e.stopPropagation()}>
              <AnimatedLikeButton
                isLiked={isLiked}
                onToggle={(e) => {
                  e.stopPropagation();
                  if (activeTrack) toggleLike(activeTrack);
                }}
                iconClassName="w-5 h-5"
                className={
                  isLiked
                    ? 'text-rose-500'
                    : 'text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                }
              />
            </div>

            {/* Play/Pause/Spinner Button */}
            <button
              type="button"
              aria-busy={isLoadingTrack && !isSnippetPlaying}
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              aria-label={
                isLoadingTrack && !isSnippetPlaying
                  ? t('Отменить загрузку')
                  : isPlaying
                    ? t('Пауза')
                    : t('Воспроизведение')
              }
              className="w-10 h-10 rounded-full bg-soso-brand hover:bg-soso-brand-light text-black flex items-center justify-center shadow-md spring-press transition-all"
            >
              {isLoadingTrack ? (
                <Loader2 className="w-5 h-5 animate-spin text-black" />
              ) : isPlaying ? (
                <Pause className="w-5 h-5 fill-current" />
              ) : (
                <Play className="w-5 h-5 fill-current ml-0.5" />
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
