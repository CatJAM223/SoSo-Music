import { useEffect, useRef, useState, useCallback } from 'react';
import type { Track } from '../types';
import { platformBridge } from '../bridge/platformBridge';
import { detectTrackSource } from '../utils/formatters';

/** Refresh after committed mutations, preserving the visible list and its scroll position. */
export function usePlaylistTracks(playlistId: string) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const loadPlaylistTracks = useCallback(async () => {
    const generation = ++request.current;
    try {
      const rows = await platformBridge.getPlaylistTracks(playlistId);
      if (generation !== request.current) return;
      setTracks(
        rows.map((row) => {
          let cover = row.cover_url || '';
          if (cover.includes('sndcdn.com')) cover = cover.replace('-large.', '-t500x500.');
          if (cover.includes('unsplash.com')) cover = '';
          return {
            id: row.track_deezer_id,
            title: row.title,
            artist: { name: row.artist },
            album: {
              title: row.album || '',
              cover,
              cover_medium: cover,
              cover_big: cover,
              cover_xl: cover,
            },
            duration: row.duration || 180,
            preview: row.preview_url,
            source: detectTrackSource(row),
          };
        }),
      );
    } catch (error) {
      console.error('Error loading playlist tracks:', error);
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }, [playlistId]);

  useEffect(() => {
    setTracks([]);
    setLoading(true);
    void loadPlaylistTracks();
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const changed = (event: Event) => {
      const id = (event as CustomEvent<{ playlistId?: string }>).detail?.playlistId;
      if (id && id !== playlistId) return;
      // Invalidate an in-flight pre-mutation snapshot immediately.
      request.current++;
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => void loadPlaylistTracks(), 40);
    };
    window.addEventListener('soso:playlists-updated', changed);
    return () => {
      request.current++;
      clearTimeout(refreshTimer);
      window.removeEventListener('soso:playlists-updated', changed);
    };
  }, [playlistId, loadPlaylistTracks]);
  return { tracks, loading, loadPlaylistTracks };
}
