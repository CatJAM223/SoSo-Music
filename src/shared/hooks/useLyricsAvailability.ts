import { useState, useEffect, useRef } from 'react';
import { Track } from '../types';
import { platformBridge } from '../bridge/platformBridge';
import { createLyricsCacheKey } from '../utils/lyricsIdentity';
import { BoundedMap } from '../utils/boundedCache';

export interface LyricsAvailability {
  hasLyrics: boolean;
  hasChords: boolean;
  isLoading: boolean;
  trackId: string | number | null;
}

// In-memory quick lookup cache
const availabilityCache = new BoundedMap<string, { hasLyrics: boolean; hasChords: boolean }>(200);

export function useLyricsAvailability(
  currentTrack: Track | null,
  duration: number = 0,
): LyricsAvailability {
  const trackId = currentTrack?.id ?? null;
  const trackTitle = currentTrack?.title ?? '';
  const trackDuration = currentTrack?.duration || duration;
  const artistName =
    typeof currentTrack?.artist === 'object'
      ? currentTrack?.artist?.name || ''
      : String(currentTrack?.artist || '');

  const getInitialState = (): LyricsAvailability => {
    if (!trackId || !trackTitle) {
      return { hasLyrics: false, hasChords: false, isLoading: false, trackId: null };
    }
    const cacheKey = createLyricsCacheKey(trackTitle, artistName, trackDuration);
    if (availabilityCache.has(cacheKey)) {
      const cached = availabilityCache.get(cacheKey)!;
      return {
        hasLyrics: cached.hasLyrics,
        hasChords: cached.hasChords,
        isLoading: false,
        trackId,
      };
    }
    return {
      hasLyrics: false,
      hasChords: false,
      isLoading: true,
      trackId,
    };
  };

  const [state, setState] = useState<LyricsAvailability>(getInitialState);

  const activeTrackIdRef = useRef<string | number | null>(trackId);
  activeTrackIdRef.current = trackId;

  useEffect(() => {
    if (!trackId || !trackTitle) {
      setState({
        hasLyrics: false,
        hasChords: false,
        isLoading: false,
        trackId: null,
      });
      return;
    }

    const cacheKey = createLyricsCacheKey(trackTitle, artistName, trackDuration);

    if (availabilityCache.has(cacheKey)) {
      const cached = availabilityCache.get(cacheKey)!;
      setState({
        hasLyrics: cached.hasLyrics,
        hasChords: cached.hasChords,
        isLoading: false,
        trackId,
      });
      return;
    }

    let isCancelled = false;
    setState({
      hasLyrics: false,
      hasChords: false,
      isLoading: true,
      trackId,
    });

    let currentHasLyrics = false;

    // Let rapid track navigation settle before starting optional background requests.
    const lookupTimer = setTimeout(() => {
      platformBridge
        .getLyrics(trackTitle, artistName, trackDuration)
        .then((lyricsRes) => {
          if (isCancelled || activeTrackIdRef.current !== trackId) return;
          const hasLyrics = Array.isArray(lyricsRes) && lyricsRes.length > 0;
          currentHasLyrics = hasLyrics;
          setState((prev) => ({
            ...prev,
            hasLyrics,
            trackId,
          }));
          const existing = availabilityCache.get(cacheKey);
          availabilityCache.set(cacheKey, {
            hasLyrics,
            hasChords: existing?.hasChords ?? false,
          });
        })
        .catch(() => {})
        .finally(() => {
          if (isCancelled || activeTrackIdRef.current !== trackId) return;
          // If lyrics finished, we can clear loading state right away
          setState((prev) => ({
            ...prev,
            isLoading: false,
          }));
        });

      // 2. Check chords in background (does not block lyrics glow)
      platformBridge
        .getChords({ title: trackTitle, artist: artistName })
        .then((chordsRes) => {
          if (isCancelled || activeTrackIdRef.current !== trackId) return;
          const hasChords =
            !!chordsRes &&
            typeof chordsRes.rawContent === 'string' &&
            chordsRes.rawContent.trim().length > 0;
          setState((prev) => ({
            ...prev,
            hasChords,
            isLoading: false,
            trackId,
          }));
          const existing = availabilityCache.get(cacheKey);
          availabilityCache.set(cacheKey, {
            hasLyrics: existing?.hasLyrics ?? currentHasLyrics,
            hasChords,
          });
        })
        .catch(() => {
          if (isCancelled || activeTrackIdRef.current !== trackId) return;
          setState((prev) => ({
            ...prev,
            isLoading: false,
            trackId,
          }));
        });
    }, 350);
    return () => {
      isCancelled = true;
      clearTimeout(lookupTimer);
    };
  }, [trackId, trackTitle, artistName, trackDuration]);

  return state;
}
