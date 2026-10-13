import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import type { Album, ArtistDetails, Track } from '../types';
import { useAudioState, useAudioControls } from '../context/AudioContext';
import { platformBridge } from '../bridge/platformBridge';

import { formatRecordType } from '../utils/formatters';
import { normalizeArtistDetails } from '../utils/artistParser';
export { formatRecordType, normalizeArtistDetails };

export interface ArtistViewModelProps {
  artistQuery: string | number;
  artistName?: string;
  artistSource?: string;
  onNavigateToAlbum?: (album: Album) => void;
}

export function useArtistViewModel({
  artistQuery,
  artistName,
  artistSource,
  onNavigateToAlbum,
}: ArtistViewModelProps) {
  const {
    playTrack,
    togglePlay,
    toggleFollowArtist,
    isArtistFollowed,
    toggleSaveAlbum,
    isAlbumSaved,
  } = useAudioControls();
  const { currentTrack, isPlaying } = useAudioState();

  const [artistDetails, setArtistDetails] = useState<ArtistDetails | null>(null);
  const [allTracks, setAllTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingAllTracks, setLoadingAllTracks] = useState(false);
  const [activeTab, setActiveTab] = useState<'top' | 'all' | 'albums'>('top');
  const [selectedAlbum, setSelectedAlbumState] = useState<Album | null>(null);
  const albumRequestRef = useRef(0);
  const [albumTracks, setAlbumTracks] = useState<Track[]>([]);
  const [loadingAlbumTracks, setLoadingAlbumTracks] = useState(false);
  const [allTracksViewMode, setAllTracksViewMode] = useState<'list' | 'albums'>('albums');

  const setSelectedAlbum = useCallback((album: Album | null) => {
    albumRequestRef.current++;
    setSelectedAlbumState(album);
    setAlbumTracks([]);
    setLoadingAlbumTracks(false);
  }, []);

  // Search/Filter state
  const [trackSearchFilter, setTrackSearchFilter] = useState('');

  useEffect(() => {
    let isMounted = true;

    const fetchArtistData = async () => {
      if (!artistQuery) return;
      setLoading(true);
      setSelectedAlbum(null);
      setAllTracks([]);
      setTrackSearchFilter('');

      try {
        const res = await platformBridge.getArtist(artistQuery, artistName, artistSource);
        if (isMounted && res) {
          setArtistDetails(normalizeArtistDetails(res));

          // Fetch all tracks in parallel
          if (res.artist) {
            setLoadingAllTracks(true);
            platformBridge
              .getArtistAllTracks(res.artist.id, res.artist.name, artistSource)
              .then((tracks) => {
                if (isMounted) {
                  setAllTracks(tracks || []);
                  setLoadingAllTracks(false);
                }
              })
              .catch(() => {
                if (isMounted) setLoadingAllTracks(false);
              });
          }
        }
      } catch (err) {
        console.error('Error loading artist profile:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchArtistData();

    return () => {
      isMounted = false;
      albumRequestRef.current++;
    };
  }, [artistQuery, artistName, artistSource, setSelectedAlbum]);

  const handlePlayTopTracks = () => {
    if (!artistDetails || artistDetails.topTracks.length === 0) return;
    const isPlayingArtist =
      currentTrack && artistDetails.topTracks.some((t) => String(t.id) === String(currentTrack.id));

    if (isPlayingArtist) {
      togglePlay();
    } else {
      playTrack(artistDetails.topTracks[0], artistDetails.topTracks);
    }
  };

  const filteredAllTracks = useMemo(() => {
    if (!trackSearchFilter.trim()) return allTracks;
    const q = trackSearchFilter.toLowerCase().trim();
    return allTracks.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        (t.album?.title && t.album.title.toLowerCase().includes(q)),
    );
  }, [allTracks, trackSearchFilter]);

  const handlePlayAllTracks = () => {
    if (filteredAllTracks.length > 0) {
      playTrack(filteredAllTracks[0], filteredAllTracks);
    }
  };

  const handleAlbumClick = async (album: Album) => {
    if (onNavigateToAlbum) {
      onNavigateToAlbum(album);
      return;
    }

    setSelectedAlbum(album);
    const requestId = albumRequestRef.current;
    const isCurrent = () => requestId === albumRequestRef.current;
    setLoadingAlbumTracks(true);
    try {
      const tracks = await platformBridge.getAlbumTracks(
        album.id,
        album.title,
        artistDetails?.artist?.name,
      );
      if (isCurrent()) setAlbumTracks(tracks || []);
    } catch (e) {
      if (!isCurrent()) return;
      console.error('Failed to load album tracks:', e);
      setAlbumTracks([]);
    } finally {
      if (isCurrent()) setLoadingAlbumTracks(false);
    }
  };

  const handlePlayAlbum = () => {
    if (albumTracks.length > 0) {
      playTrack(albumTracks[0], albumTracks);
    }
  };

  const groupedTracksByAlbum = useMemo(() => {
    const albumGroups = new Map<string, { albumInfo: any; tracks: Track[] }>();
    const singles: Track[] = [];

    const albumMetaMap = new Map<string, any>();
    for (const alb of artistDetails?.albums || []) {
      if (alb.title) {
        albumMetaMap.set(alb.title.toLowerCase().trim(), alb);
      }
    }

    for (const track of filteredAllTracks) {
      const albTitle = track.album?.title?.trim();
      if (!albTitle || albTitle === 'Single' || albTitle === 'Unknown Album') {
        singles.push(track);
      } else {
        const key = albTitle.toLowerCase();
        if (!albumGroups.has(key)) {
          const meta = albumMetaMap.get(key) || {
            id: track.album?.id || `alb_${encodeURIComponent(albTitle)}`,
            title: albTitle,
            cover: track.album?.cover_big || track.album?.cover_medium || track.album?.cover,
            artist: track.artist,
          };
          albumGroups.set(key, { albumInfo: meta, tracks: [] });
        }
        albumGroups.get(key)!.tracks.push(track);
      }
    }

    return {
      groups: Array.from(albumGroups.values()),
      singles,
    };
  }, [filteredAllTracks, artistDetails?.albums]);

  return {
    artistDetails,
    loading,
    allTracks,
    loadingAllTracks,
    activeTab,
    setActiveTab,
    selectedAlbum,
    setSelectedAlbum,
    albumTracks,
    loadingAlbumTracks,
    allTracksViewMode,
    setAllTracksViewMode,
    trackSearchFilter,
    setTrackSearchFilter,
    filteredAllTracks,
    groupedTracksByAlbum,
    handlePlayTopTracks,
    handlePlayAllTracks,
    handleAlbumClick,
    handlePlayAlbum,
    formatRecordType,
    // Pass-through audio context helpers
    playTrack,
    currentTrack,
    isPlaying,
    toggleFollowArtist,
    isArtistFollowed,
    toggleSaveAlbum,
    isAlbumSaved,
  };
}
