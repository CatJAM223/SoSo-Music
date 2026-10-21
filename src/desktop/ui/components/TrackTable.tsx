import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useState, useEffect, useRef } from 'react';
import { Track } from '../../../shared/types';
import type { PlaybackOrigin } from '../../../shared/types/tastePolicy';
import { TrackRow } from './TrackRow';
import { formatTotalDuration } from '../../../shared/utils/formatters';

interface TrackTableProps {
  tracks: Track[];
  onOpenAddToPlaylist: (track: Track) => void;
  playlistContext?: Track[];
  playbackOrigin?: PlaybackOrigin;
  onPlayTrack?: (track: Track) => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: any) => void;
  hideAlbumColumn?: boolean;
  totalDurationSeconds?: number;
}

const ROW_HEIGHT = 56;
const OVERSCAN = 12;

export const TrackTable: React.FC<TrackTableProps> = ({
  tracks,
  onOpenAddToPlaylist,
  playlistContext,
  playbackOrigin,
  onPlayTrack,
  onNavigateToArtist,
  onNavigateToAlbum,
  hideAlbumColumn = false,
  totalDurationSeconds,
}) => {
  useLocale();
  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(800);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || tracks.length <= 40) return;

    const scrollParent = container.closest('main') || window;

    let rafId: number;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!containerRef.current) return;
        if (scrollParent === window) {
          const rect = containerRef.current.getBoundingClientRect();
          setScrollTop(Math.max(0, -rect.top));
          setViewportHeight(window.innerHeight);
        } else {
          const scrollEl = scrollParent as HTMLElement;
          const containerRect = containerRef.current.getBoundingClientRect();
          const parentRect = scrollEl.getBoundingClientRect();
          setScrollTop(Math.max(0, parentRect.top - containerRect.top));
          setViewportHeight(scrollEl.clientHeight);
        }
      });
    };

    handleScroll();
    scrollParent.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll, { passive: true });
    return () => {
      cancelAnimationFrame(rafId);
      scrollParent.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [tracks.length]);

  if (tracks.length === 0) {
    return (
      <div className="py-16 text-center text-slate-500 dark:text-zinc-500">
        <p className="text-sm font-medium">{t('Нет доступных треков')}</p>
      </div>
    );
  }

  const shouldVirtualize = tracks.length > 40;
  const startIndex = shouldVirtualize
    ? Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
    : 0;
  const endIndex = shouldVirtualize
    ? Math.min(tracks.length, Math.ceil((scrollTop + viewportHeight) / ROW_HEIGHT) + OVERSCAN)
    : tracks.length;
  const visibleTracks = shouldVirtualize ? tracks.slice(startIndex, endIndex) : tracks;
  const topPadding = shouldVirtualize ? startIndex * ROW_HEIGHT : 0;
  const bottomPadding = shouldVirtualize ? (tracks.length - endIndex) * ROW_HEIGHT : 0;

  return (
    <div ref={containerRef} className="w-full">
      {/* Table Header (Desktop only) */}
      <div
        className={`track-grid ${hideAlbumColumn ? 'track-grid--no-album' : ''} hidden items-center gap-4 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 border-b border-slate-200 dark:border-zinc-800/80 mb-2`}
      >
        <div className="w-7 text-center">#</div>
        <div className="w-10"></div>
        <div className="min-w-0">{t('Название')}</div>
        {!hideAlbumColumn && <div className="min-w-0">{t('Альбом')}</div>}
        <div aria-hidden="true"></div>
        <div className="w-8"></div>
        <div className="w-8"></div>
        <div className="w-8"></div>
        <div className="w-12 flex justify-end">
          {totalDurationSeconds !== undefined && totalDurationSeconds > 0 ? (
            <span className="shrink-0 whitespace-nowrap text-[11px] font-medium normal-case tracking-normal tabular-nums">
              {formatTotalDuration(totalDurationSeconds)}
            </span>
          ) : (
            <span className="sr-only">{t('Длительность')}</span>
          )}
        </div>
      </div>

      {/* Track Rows */}
      <div
        className="space-y-1"
        style={{
          paddingTop: topPadding > 0 ? `${topPadding}px` : undefined,
          paddingBottom: bottomPadding > 0 ? `${bottomPadding}px` : undefined,
        }}
      >
        {visibleTracks.map((track, i) => {
          const idx = startIndex + i;
          return (
            <TrackRow
              key={`${track.id}-${idx}`}
              track={track}
              index={idx}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              playlistContext={playlistContext || tracks}
              playbackOrigin={playbackOrigin}
              onPlayTrack={onPlayTrack}
              onNavigateToArtist={onNavigateToArtist}
              onNavigateToAlbum={onNavigateToAlbum}
              hideAlbumColumn={hideAlbumColumn}
            />
          );
        })}
      </div>
    </div>
  );
};
