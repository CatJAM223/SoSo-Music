import { useEffect, useState, useMemo } from 'react';
import type { Album, Track } from '../types';
import { useAudioState, useAudioControls } from '../context/AudioContext';
import { platformBridge } from '../bridge/platformBridge';
import { DEFAULT_COVER_SVG_DATA_URI } from '../utils/placeholder';
import { formatRecordType } from '../utils/formatters';
export { formatRecordType };

export interface AlbumViewModelProps {
  album:
    | Album
    | {
        id: string | number;
        title?: string;
        cover?: string;
        cover_url?: string;
        cover_medium?: string;
        cover_big?: string;
        cover_xl?: string;
        artist?: any;
        artist_name?: string;
        release_date?: string;
        record_type?: string;
        track_count?: number;
        source?: 'soundcloud' | 'youtube' | 'deezer';
      };
}

export function useAlbumViewModel({ album }: AlbumViewModelProps) {
  const { currentTrack, isPlaying } = useAudioState();
  const { playTrack, togglePlay } = useAudioControls();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  const safeAlbum = album || ({} as any);
  const initialAlbumId = safeAlbum.id;
  const initialAlbumTitle = safeAlbum.title || 'Альбом';
  const initialArtistName =
    (safeAlbum as any).artist_name ||
    (typeof safeAlbum.artist === 'object' ? safeAlbum.artist?.name : safeAlbum.artist) ||
    'Неизвестный исполнитель';
  const initialArtistId = typeof safeAlbum.artist === 'object' ? safeAlbum.artist?.id : undefined;

  useEffect(() => {
    let isMounted = true;

    const loadAlbumTracks = async () => {
      setLoading(true);
      try {
        const list = await platformBridge.getAlbumTracks(
          initialAlbumId,
          initialAlbumTitle,
          initialArtistName,
        );
        if (isMounted) {
          setTracks(list || []);
        }
      } catch (e) {
        console.error('Failed to load album tracks:', e);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadAlbumTracks();

    return () => {
      isMounted = false;
    };
  }, [initialAlbumId, initialAlbumTitle, initialArtistName]);

  // Enrich album ID if it was originally an artificial placeholder (e.g. alb_*)
  const resolvedAlbumId = useMemo(() => {
    if (initialAlbumId && !String(initialAlbumId).startsWith('alb_')) {
      return initialAlbumId;
    }
    const firstTrackAlbumId = tracks[0]?.album?.id;
    if (firstTrackAlbumId && !String(firstTrackAlbumId).startsWith('alb_')) {
      return firstTrackAlbumId;
    }
    return initialAlbumId;
  }, [initialAlbumId, tracks]);

  // Enrich album title
  const albumTitle = useMemo(() => {
    if (initialAlbumTitle && initialAlbumTitle !== 'Альбом' && initialAlbumTitle !== 'Album') {
      return initialAlbumTitle;
    }
    return tracks[0]?.album?.title || initialAlbumTitle;
  }, [initialAlbumTitle, tracks]);

  // Enrich artist name
  const artistName = useMemo(() => {
    if (
      initialArtistName &&
      initialArtistName !== 'Неизвестный исполнитель' &&
      initialArtistName !== 'Unknown Artist'
    ) {
      return initialArtistName;
    }
    return tracks[0]?.artist?.name || initialArtistName;
  }, [initialArtistName, tracks]);

  // Enrich artist ID
  const artistId = useMemo(() => {
    if (initialArtistId) return initialArtistId;
    return tracks[0]?.artist?.id;
  }, [initialArtistId, tracks]);

  // Enrich record type (Single, EP, Album)
  const recordType = useMemo(() => {
    if (safeAlbum.record_type) {
      return safeAlbum.record_type;
    }
    if (tracks.length === 1) return 'single';
    if (tracks.length > 1 && tracks.length <= 4) return 'ep';
    return 'album';
  }, [safeAlbum.record_type, tracks.length]);

  // Enrich release date
  const releaseDate = useMemo(() => {
    if (safeAlbum.release_date) {
      return safeAlbum.release_date;
    }
    return (tracks[0]?.album as any)?.release_date || (tracks[0] as any)?.release_date || '';
  }, [safeAlbum.release_date, tracks]);

  // Enrich artwork cover with HD priority
  const coverUrl = useMemo(() => {
    const trackCover =
      tracks[0]?.album?.cover_xl ||
      tracks[0]?.album?.cover_big ||
      tracks[0]?.album?.cover_medium ||
      tracks[0]?.album?.cover;

    if (trackCover && !trackCover.includes('unsplash.com') && !trackCover.includes('-large.')) {
      return trackCover;
    }

    const passedCover =
      safeAlbum.cover_xl ||
      safeAlbum.cover_big ||
      safeAlbum.cover_medium ||
      safeAlbum.cover ||
      (safeAlbum as any).cover_url;

    if (passedCover && !passedCover.includes('unsplash.com')) {
      return passedCover;
    }

    return trackCover || passedCover || DEFAULT_COVER_SVG_DATA_URI;
  }, [safeAlbum, tracks]);

  const isCurrentTrackInAlbum = Boolean(
    currentTrack && tracks.some((t) => String(t.id) === String(currentTrack.id)),
  );
  const isPlayingThisAlbum = isCurrentTrackInAlbum && isPlaying;

  const handlePlayAlbum = () => {
    if (tracks.length === 0) return;
    if (isCurrentTrackInAlbum) {
      togglePlay();
    } else {
      playTrack(tracks[0], tracks);
    }
  };

  const totalDurationSecs = useMemo(
    () => tracks.reduce((acc, t) => acc + (t.duration || 180), 0),
    [tracks],
  );

  return {
    tracks,
    loading,
    albumId: resolvedAlbumId,
    albumTitle,
    artistName,
    artistId,
    recordType,
    releaseDate,
    coverUrl,
    isCurrentTrackInAlbum,
    isPlayingThisAlbum,
    handlePlayAlbum,
    totalDurationSecs,
    formatRecordType,
  };
}
