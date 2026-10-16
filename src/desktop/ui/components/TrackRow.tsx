import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React from 'react';
import { TasteContextMenu } from '../../../shared/components/TasteContextMenu';
import { Play, Pause, Download, CheckCircle2, Loader2 } from 'lucide-react';
import { Track } from '../../../shared/types';
import type { PlaybackOrigin } from '../../../shared/types/tastePolicy';
import {
  useAudioState,
  useAudioControls,
  useAudioProgress,
} from '../../../shared/context/AudioContext';
import { advanceTrackArtwork } from '../../../shared/utils/trackArtwork';
import { formatTime, detectTrackSource, resolveTrackCover } from '../../../shared/utils/formatters';
import { parseArtists } from '../../../shared/utils/artistParser';
import { SourceBadge } from './SourceBadge';
import { cleanAlbumTitle } from '../../../shared/utils/albumMetadata';
import { AnimatedLikeButton } from '../../../shared/components/BrokenHeartEffect';
import { OfflineProgressRing } from '../../../shared/components/OfflineProgressRing';
import { useOfflineDownloadProgress } from '../../../shared/services/offlineDownloadProgress';

interface TrackRowProps {
  track: Track;
  index: number;
  onOpenAddToPlaylist: (track: Track) => void;
  playlistContext?: Track[];
  playbackOrigin?: PlaybackOrigin;
  onPlayTrack?: (track: Track) => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: any) => void;
  hideAlbumColumn?: boolean;
}

import { shouldRenderTrackRow } from '../../../shared/utils/playerGuards';
export { shouldRenderTrackRow };

// Subscribe only the active snippet's fill to the frequently changing playback clock.
const SnippetProgress = () => {
  useLocale();
  const { snippetProgress } = useAudioProgress();
  return (
    <div
      className="absolute left-0 top-0 bottom-0 bg-white/25 pointer-events-none smooth-progress"
      style={{ width: `${Math.min(100, Math.max(0, snippetProgress * 100))}%` }}
    />
  );
};

const SnippetButton: React.FC<{
  isSnippetActive: boolean;
  isSnippetPlaying: boolean;
  onSnippetClick: (e: React.MouseEvent) => void;
}> = React.memo(({ isSnippetActive, isSnippetPlaying, onSnippetClick }) => {
  useLocale();
  return (
    <div
      className={`hidden sm:flex w-20 flex-shrink-0 justify-center transition-opacity duration-150 ${
        isSnippetActive
          ? 'opacity-100'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
      }`}
    >
      <button
        onClick={onSnippetClick}
        type="button"
        aria-label={
          isSnippetActive && isSnippetPlaying
            ? t('Остановить сниппет')
            : t('Слушать 10-секундный сниппет')
        }
        aria-pressed={isSnippetActive}
        className="snippet-button relative overflow-hidden flex items-center px-2.5 py-1 md:px-3 md:py-1.5 rounded-full text-[11px] md:text-xs font-semibold transition-colors duration-200"
      >
        {isSnippetActive && <SnippetProgress />}

        <span className="relative z-10">{t('Сниппет')}</span>
      </button>
    </div>
  );
});

export const TrackRow: React.FC<TrackRowProps> = React.memo(
  ({
    track,
    index,
    onOpenAddToPlaylist,
    playlistContext,
    playbackOrigin,
    onPlayTrack,
    onNavigateToArtist,
    onNavigateToAlbum,
    hideAlbumColumn = false,
  }) => {
    useLocale();
    const {
      currentTrack,
      isPlaying,
      isLoadingTrack,
      isWaveStarting,
      snippetTrack,
      isSnippetPlaying,
      likedTrackIds,
    } = useAudioState();

    const {
      playTrack,
      togglePlay,
      previewSnippet,
      stopSnippet,
      toggleLike,
      isOfflineCached,
      cacheTrackForOffline,
      removeOfflineCachedTrack,
    } = useAudioControls();

    const youtubeDisabled = useYouTubeAvailability();
    const downloadProgress = useOfflineDownloadProgress(track?.id ?? '');
    const isDownloading = downloadProgress !== null;

    if (!shouldRenderTrackRow(track)) return null;

    const isCurrentFullTrack = !!(currentTrack && String(currentTrack.id) === String(track.id));
    const isCurrentlyPlayingFull = !!(isCurrentFullTrack && isPlaying && !isSnippetPlaying);
    const isCurrentlyLoadingFull = !!(
      isCurrentFullTrack &&
      isLoadingTrack &&
      !isWaveStarting &&
      !isSnippetPlaying
    );

    const isCurrentSnippet = !!(snippetTrack && String(snippetTrack.id) === String(track.id));
    const isSnippetActive = !!(isCurrentSnippet && isSnippetPlaying);

    const trackIdStr = String(track.id);
    const albumTitle = cleanAlbumTitle(track.album?.title);
    const cleanId = trackIdStr.replace(/^dz_/, '');
    const isLiked =
      likedTrackIds.has(trackIdStr) ||
      likedTrackIds.has(cleanId) ||
      likedTrackIds.has(`dz_${cleanId}`);

    const handleFullPlay = () => {
      if (isCurrentFullTrack && !isSnippetPlaying) {
        togglePlay();
      } else {
        if (onPlayTrack) onPlayTrack(track);
        else playTrack(track, playlistContext, false, undefined, playbackOrigin);
      }
    };

    const handleSnippetClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isSnippetActive && isSnippetPlaying) {
        stopSnippet();
      } else {
        previewSnippet(track);
      }
    };

    const handleLikeClick = (e: React.MouseEvent) => {
      e.stopPropagation();
      toggleLike(track);
    };

    const coverUrl = resolveTrackCover(track);

    return (
      <div
        {...youtubeDisabledProps(track, youtubeDisabled)}
        draggable={!youtubeDisabledProps(track, youtubeDisabled)['aria-disabled']}
        onDragStart={(e) => {
          e.dataTransfer.setData(
            'application/json',
            JSON.stringify({
              type: 'EXTERNAL_TRACK',
              track: { ...track, queueOrigin: playbackOrigin },
            }),
          );
          e.dataTransfer.setData('text/plain', `track:${track.id}`);
          e.dataTransfer.effectAllowed = 'copyMove';
        }}
        onClick={handleFullPlay}
        data-track-id={String(track.id)}
        data-playback-state={
          isCurrentlyLoadingFull
            ? 'loading'
            : isCurrentlyPlayingFull
              ? 'playing'
              : isCurrentFullTrack
                ? 'paused'
                : 'idle'
        }
        aria-busy={isCurrentlyLoadingFull}
        className={`soso-track-row track-grid ${hideAlbumColumn ? 'track-grid--no-album' : ''} group relative flex items-center gap-2 md:gap-4 px-2.5 py-1.5 md:px-4 md:py-2 rounded-lg transition-colors duration-150 select-none cursor-pointer active:cursor-grabbing ${
          isCurrentlyPlayingFull || isCurrentlyLoadingFull
            ? 'bg-soso-brand/10 dark:bg-soso-brand/[0.08] text-soso-brand font-medium'
            : isSnippetActive
              ? 'bg-purple-500/15 text-purple-400'
              : 'hover:bg-slate-200/60 dark:hover:bg-white/[0.04] text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white'
        }`}
      >
        {/* Index Number or Soundwave Equalizer when playing */}
        <div className="w-5 md:w-7 text-center text-[10px] md:text-xs font-medium text-slate-500 dark:text-zinc-400 flex-shrink-0 flex items-center justify-center tabular-nums">
          {isCurrentlyLoadingFull ? (
            <Loader2
              className="w-3.5 h-3.5 animate-spin text-soso-brand"
              aria-label={t('Загрузка трека')}
            />
          ) : isCurrentlyPlayingFull ? (
            <div className="flex items-end justify-center gap-0.5 h-3 w-3 md:h-3.5 md:w-3.5">
              <span className="w-0.5 bg-soso-brand rounded-full animate-soundwave-1" />
              <span className="w-0.5 bg-soso-brand rounded-full animate-soundwave-2" />
              <span className="w-0.5 bg-soso-brand rounded-full animate-soundwave-3" />
            </div>
          ) : (
            <span>{index + 1}</span>
          )}
        </div>

        {/* Album Cover Thumbnail with Play/Pause button */}
        <div className="relative w-9 h-9 md:w-10 md:h-10 rounded-md overflow-hidden flex-shrink-0 bg-zinc-800 flex items-center justify-center group/cover">
          <img
            key={String(track.id) + ':' + coverUrl}
            src={coverUrl}
            alt={track.title}
            onError={(event) => advanceTrackArtwork(event.currentTarget, track)}
            className="w-full h-full object-cover"
            loading="lazy"
          />
          {/* Play Overlay */}
          <button
            type="button"
            aria-label={
              isCurrentlyLoadingFull
                ? t('Отменить загрузку ') + track.title
                : isCurrentlyPlayingFull
                  ? t('Приостановить ') + track.title
                  : t('Воспроизвести ') + track.title
            }
            onClick={(e) => {
              e.stopPropagation();
              handleFullPlay();
            }}
            className={`absolute inset-0 flex items-center justify-center cursor-pointer transition-opacity ${
              isCurrentlyPlayingFull || isCurrentlyLoadingFull
                ? 'bg-black/50 opacity-100'
                : 'bg-black/40 opacity-0 group-hover/cover:opacity-100 group-hover:opacity-100'
            }`}
          >
            {isCurrentlyLoadingFull ? (
              <Loader2 className="w-4 h-4 md:w-5 md:h-5 text-soso-brand animate-spin" />
            ) : isCurrentlyPlayingFull ? (
              <Pause className="w-4 h-4 md:w-5 md:h-5 text-soso-brand fill-current" />
            ) : (
              <Play className="w-4 h-4 md:w-5 md:h-5 text-white fill-current ml-0.5" />
            )}
          </button>
        </div>

        {/* Track Title & Artist */}
        <div className="flex-1 min-w-0 pr-2">
          <div
            className={`text-sm font-semibold truncate cursor-pointer hover:underline ${
              isCurrentlyPlayingFull || isCurrentlyLoadingFull
                ? 'text-soso-brand font-bold'
                : isSnippetActive
                  ? 'text-purple-400 font-bold'
                  : 'text-slate-900 dark:text-white'
            }`}
            onClick={(event) => {
              event.stopPropagation();
              handleFullPlay();
            }}
          >
            {track.title}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5 font-medium">
            <SourceBadge source={detectTrackSource(track)} size="sm" />
            <span className="truncate">
              {(() => {
                const rawArtist =
                  track.artist?.name ||
                  (typeof track.artist === 'string' ? track.artist : 'Unknown Artist');
                const parsed = parseArtists(rawArtist, track.title);
                if (parsed.length <= 1) {
                  return (
                    <span
                      onClick={(e) => {
                        if (onNavigateToArtist && rawArtist && rawArtist !== 'Unknown Artist') {
                          e.stopPropagation();
                          const source =
                            track.artist?.source || track.source || detectTrackSource(track);
                          const rawTrackId = String(track.id || '');
                          const isNumericScId =
                            track.artist?.id && String(track.artist.id).match(/^sc_art_\d+$/);
                          const artistId =
                            track.artist?.id && !isNumericScId
                              ? track.artist.id
                              : rawTrackId.startsWith('sc_') || source === 'soundcloud'
                                ? `sc_art_${rawArtist.toLowerCase().replace(/\s+/g, '_')}`
                                : rawTrackId.startsWith('yt_') || source === 'youtube'
                                  ? `yt_art_${rawArtist.toLowerCase().replace(/\s+/g, '_')}`
                                  : track.artist?.id;
                          onNavigateToArtist({
                            id: artistId,
                            name: rawArtist,
                            source,
                          } as any);
                        }
                      }}
                      className={`py-0.5 ${
                        onNavigateToArtist
                          ? 'hover:underline cursor-pointer hover:text-slate-950 dark:hover:text-white font-semibold text-slate-700 dark:text-zinc-300 active:text-soso-brand'
                          : 'hover:text-slate-900 dark:hover:text-zinc-200'
                      }`}
                    >
                      {rawArtist}
                    </span>
                  );
                }
                return parsed.map((art, idx) => (
                  <React.Fragment key={art.name + idx}>
                    <span
                      onClick={(e) => {
                        if (onNavigateToArtist) {
                          e.stopPropagation();
                          const source =
                            track.artist?.source || track.source || detectTrackSource(track);
                          const rawTrackId = String(track.id || '');
                          const artistId =
                            rawTrackId.startsWith('sc_') || source === 'soundcloud'
                              ? `sc_art_${art.name.toLowerCase().replace(/\s+/g, '_')}`
                              : rawTrackId.startsWith('yt_') || source === 'youtube'
                                ? `yt_art_${art.name.toLowerCase().replace(/\s+/g, '_')}`
                                : undefined;
                          onNavigateToArtist({
                            id: artistId,
                            name: art.name,
                            source,
                          } as any);
                        }
                      }}
                      className="hover:underline cursor-pointer hover:text-slate-950 dark:hover:text-white font-semibold text-slate-700 dark:text-zinc-300 active:text-soso-brand"
                    >
                      {art.name}
                    </span>
                    {idx < parsed.length - 1 && (
                      <span className="text-slate-400 dark:text-zinc-500">, </span>
                    )}
                  </React.Fragment>
                ));
              })()}
            </span>
          </div>
        </div>

        {/* Album / Genre Name (Clickable, hidden when viewing album) */}
        {!hideAlbumColumn && (
          <div className="hidden md:block min-w-0 text-xs text-slate-500 dark:text-zinc-400 truncate pr-2">
            <span
              onClick={(e) => {
                if (onNavigateToAlbum && albumTitle !== 'Single') {
                  e.stopPropagation();
                  onNavigateToAlbum({
                    id: track.album?.id || `alb_${encodeURIComponent(track.album.title)}`,
                    title: albumTitle,
                    cover: track.album.cover_big || track.album.cover_medium || track.album.cover,
                    cover_medium: track.album.cover_medium,
                    cover_big: track.album.cover_big,
                    cover_xl: track.album.cover_xl,
                    artist: track.artist,
                    source: track.source || detectTrackSource(track),
                  });
                }
              }}
              className={
                onNavigateToAlbum && albumTitle !== 'Single'
                  ? 'hover:underline cursor-pointer hover:text-slate-900 dark:hover:text-white font-medium transition-colors'
                  : ''
              }
            >
              {albumTitle}
            </span>
          </div>
        )}

        {/* 10-Second Midpoint Snippet Button (Сниппет) */}
        <SnippetButton
          isSnippetActive={isSnippetActive}
          isSnippetPlaying={isSnippetPlaying}
          onSnippetClick={handleSnippetClick}
        />

        {/* Like Button */}
        <div className="w-8 flex-shrink-0 flex justify-center">
          <AnimatedLikeButton
            isLiked={isLiked}
            onToggle={handleLikeClick}
            className={`hover:scale-125 ${
              isLiked ? 'opacity-100' : 'opacity-60 md:opacity-0 group-hover:opacity-100'
            }`}
          />
        </div>

        {/* Offline Download Button */}
        <div className="w-8 flex-shrink-0 flex justify-center">
          <button
            onClick={async (e) => {
              e.stopPropagation();
              if (isDownloading) return;
              const cached = isOfflineCached(track.id);
              if (cached) {
                await removeOfflineCachedTrack(track.id);
              } else {
                await cacheTrackForOffline(track);
              }
            }}
            type="button"
            disabled={isDownloading}
            title={
              isDownloading
                ? t('Скачивание: {0}%', Math.round((downloadProgress ?? 0) * 100))
                : isOfflineCached(track.id)
                  ? t('Сохранено офлайн (нажмите для удаления)')
                  : t('Скачать для офлайн прослушивания')
            }
            aria-label={
              isDownloading
                ? t('Скачивается для офлайна')
                : isOfflineCached(track.id)
                  ? t('Удалить офлайн копию')
                  : t('Скачать для офлайна')
            }
            className={`p-1 md:p-1.5 rounded-full transition-all active:scale-125 ${
              isDownloading || isOfflineCached(track.id)
                ? 'text-soso-brand opacity-100'
                : 'text-slate-400 dark:text-zinc-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200 dark:hover:bg-zinc-700/60 opacity-60 md:opacity-0 group-hover:opacity-100'
            }`}
          >
            {isDownloading ? (
              <span
                className="relative flex flex-col items-center gap-0.5"
                role="progressbar"
                aria-label={t('Скачивание трека')}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round((downloadProgress ?? 0) * 100)}
              >
                <OfflineProgressRing progress={downloadProgress ?? 0} size={18} />
                <span className="absolute top-full mt-0.5 text-[9px] font-semibold leading-none tabular-nums whitespace-nowrap">
                  {Math.round((downloadProgress ?? 0) * 100)}%
                </span>
              </span>
            ) : isOfflineCached(track.id) ? (
              <CheckCircle2 className="w-3.5 h-3.5 md:w-4 md:h-4 fill-soso-brand/20" />
            ) : (
              <Download className="w-3.5 h-3.5 md:w-4 md:h-4" />
            )}
          </button>
        </div>

        <div className="w-8 flex-shrink-0 flex justify-center">
          <TasteContextMenu
            scope="track"
            id={track.id}
            label={track.title + ' — ' + track.artist?.name}
            onAdd={() => onOpenAddToPlaylist(track)}
          />
        </div>

        {/* Duration */}
        <div className="w-9 md:w-12 text-right text-[11px] md:text-xs text-slate-500 dark:text-zinc-400 font-sans tabular-nums font-medium flex-shrink-0">
          {formatTime(track.duration)}
        </div>
      </div>
    );
  },
);
