import { useEffect, useRef } from 'react';
import { Track } from '../types';

import { logger } from '../utils/logger';

interface UseMediaSessionIntegrationProps {
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  duration: number;
  getCurrentTime: () => number;
  onPlay: () => void;
  onPause: () => void;
  onNext: () => void;
  onPrev: () => void;
  onSeek: (position: number) => void;
  isTransitioningTrackRef: React.MutableRefObject<boolean>;
  trackTransitionTimestampRef: React.MutableRefObject<number>;
}

export function useMediaSessionIntegration({
  currentTrack,
  isPlaying,
  isLoadingTrack,
  duration,
  getCurrentTime,
  onPlay,
  onPause,
  onNext,
  onPrev,
  onSeek,
}: UseMediaSessionIntegrationProps) {
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onNextRef = useRef(onNext);
  const onPrevRef = useRef(onPrev);
  const onSeekRef = useRef(onSeek);

  useEffect(() => {
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
    onNextRef.current = onNext;
    onPrevRef.current = onPrev;
    onSeekRef.current = onSeek;
  });

  // 1. Sync metadata with Web MediaSession
  useEffect(() => {
    if (currentTrack) {
      const artistName =
        currentTrack.artist?.name ||
        (typeof currentTrack.artist === 'string' ? currentTrack.artist : '') ||
        'Исполнитель';

      const albumTitle =
        currentTrack.album?.title ||
        (typeof currentTrack.album === 'string' ? currentTrack.album : '') ||
        'SoSo Music';

      const coverUrl =
        currentTrack.cover_url ||
        currentTrack.album?.cover_medium ||
        currentTrack.album?.cover ||
        currentTrack.album?.cover_big ||
        (typeof currentTrack.album === 'string' ? currentTrack.album : '') ||
        '';

      if (
        typeof navigator !== 'undefined' &&
        'mediaSession' in navigator &&
        (window as any).MediaMetadata
      ) {
        try {
          navigator.mediaSession.metadata = new MediaMetadata({
            title: currentTrack.title || 'Трек',
            artist: artistName,
            album: albumTitle,
            artwork: coverUrl
              ? [
                  { src: coverUrl, sizes: '96x96', type: 'image/jpeg' },
                  { src: coverUrl, sizes: '128x128', type: 'image/jpeg' },
                  { src: coverUrl, sizes: '192x192', type: 'image/jpeg' },
                  { src: coverUrl, sizes: '256x256', type: 'image/jpeg' },
                  { src: coverUrl, sizes: '512x512', type: 'image/jpeg' },
                ]
              : [],
          });
        } catch (e) {
          logger.warn('[MediaSession] Failed to set Web MediaMetadata:', e);
        }
      }
    } else {
      if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
        try {
          navigator.mediaSession.metadata = null;
          navigator.mediaSession.playbackState = 'none';
        } catch (e) {
          logger.warn('[MediaSession] Failed to reset Web MediaSession:', e);
        }
      }
    }
  }, [currentTrack, duration, isPlaying, isLoadingTrack]);

  // 2. Sync playbackState & positionState
  useEffect(() => {
    if (!currentTrack) return;
    const dur = duration > 0 ? duration : 180;
    const pos = Math.min(Math.max(0, getCurrentTime() || 0), dur);

    if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
      try {
        navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
        if (typeof navigator.mediaSession.setPositionState === 'function') {
          navigator.mediaSession.setPositionState({
            duration: dur,
            playbackRate: 1,
            position: pos,
          });
        }
      } catch (e) {
        logger.warn('[MediaSession] Failed to set position state:', e);
      }
    }
  }, [currentTrack, isPlaying, isLoadingTrack, duration]);

  // 3. Register Web MediaSession Action Handlers
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;

    const actionHandlers: [MediaSessionAction, MediaSessionActionHandler | null][] = [
      ['play', () => onPlayRef.current()],
      [
        'pause',
        () => {
          onPauseRef.current();
        },
      ],
      ['previoustrack', () => onPrevRef.current()],
      ['nexttrack', () => onNextRef.current()],
      [
        'seekto',
        (details) => {
          if (details.seekTime !== undefined) {
            onSeekRef.current(details.seekTime);
          }
        },
      ],
    ];

    actionHandlers.forEach(([action, handler]) => {
      try {
        navigator.mediaSession.setActionHandler(action, handler);
      } catch (e) {
        logger.warn(`[MediaSession] Action "${action}" not supported`);
      }
    });

    return () => {
      actionHandlers.forEach(([action]) => {
        try {
          navigator.mediaSession.setActionHandler(action, null);
        } catch (e) {}
      });
    };
  }, []);
}
