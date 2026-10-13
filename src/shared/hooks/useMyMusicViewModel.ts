import { subscribePlaylistUpdates } from '../utils/playlistEvents';
import { filterLibraryTracks } from '../utils/librarySearch.ts';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type {
  FollowedArtist,
  LikedTrack,
  ListeningHistoryItem,
  Playlist,
  SavedAlbum,
  Track,
} from '../types';
import { useAudioState, useAudioControls } from '../context/AudioContext';
import { platformBridge } from '../bridge/platformBridge';
import { offlineCacheService } from '../services/offlineCacheService';
import { detectTrackSource } from '../utils/formatters';

export type MyMusicTab = 'tracks' | 'playlists' | 'albums' | 'artists' | 'history' | 'offline';

export interface MyMusicViewModelProps {
  initialTab?: MyMusicTab;
  initialQuery?: string;
  refreshPlaylistsTrigger?: number;
}

export function useMyMusicViewModel({
  initialTab = 'tracks',
  initialQuery = '',
  refreshPlaylistsTrigger,
}: MyMusicViewModelProps = {}) {
  const { likedTrackIds, savedAlbumIds, followedArtistIds, cachedTrackIds } = useAudioState();
  const { playTrack, toggleSaveAlbum, toggleFollowArtist } = useAudioControls();

  // A list read belongs to this mounted page and its latest refresh only.
  const mounted = useRef(true);
  const listReads = useRef(new Map<string, symbol>());
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      listReads.current.clear();
    };
  }, []);
  const beginRead = useCallback((key: string) => {
    const ticket = Symbol(key);
    listReads.current.set(key, ticket);
    return () => mounted.current && listReads.current.get(key) === ticket;
  }, []);

  const [activeTab, setActiveTab] = useState<MyMusicTab>(initialTab);

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab);
    }
  }, [initialTab]);

  // Playlists state
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loadingPlaylists, setLoadingPlaylists] = useState(true);

  // Tracks state
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loadingTracks, setLoadingTracks] = useState(true);

  // Saved albums state
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [loadingAlbums, setLoadingAlbums] = useState(true);

  // Followed artists state
  const [followedArtists, setFollowedArtists] = useState<FollowedArtist[]>([]);
  const [loadingArtists, setLoadingArtists] = useState(true);

  // History state
  const [historyItems, setHistoryItems] = useState<ListeningHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  // Offline tracks state
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [loadingOffline, setLoadingOffline] = useState(false);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const queryLower = searchQuery.trim().toLowerCase();

  const loadPlaylists = useCallback(async () => {
    const isCurrent = beginRead('playlists');
    if (!isCurrent()) return;
    setLoadingPlaylists(true);
    try {
      const list = await platformBridge.getPlaylists();
      if (!isCurrent()) return;
      setPlaylists(list || []);
    } catch (e) {
      console.error('Error loading playlists:', e);
    } finally {
      if (isCurrent()) setLoadingPlaylists(false);
    }
  }, [beginRead]);

  const loadLikedTracks = useCallback(async () => {
    const isCurrent = beginRead('tracks');
    if (!isCurrent()) return;
    setLoadingTracks(true);
    try {
      const likedList: LikedTrack[] = await platformBridge.getLikedTracks();
      if (!isCurrent()) return;
      const formatted: Track[] = (likedList || []).map((item) => {
        let cover = item.cover_url || '';
        if (cover.includes('sndcdn.com') && cover.includes('-large.')) {
          cover = cover.replace('-large.', '-t500x500.');
        }
        if (cover.includes('unsplash.com')) {
          cover = '';
        }
        const detectedSource = detectTrackSource(item);
        const rawId = String(item.deezer_id || '');
        let artistId: string | undefined;
        if (rawId.startsWith('sc_') || detectedSource === 'soundcloud') {
          artistId = `sc_art_${item.artist.toLowerCase().replace(/\s+/g, '_')}`;
        } else if (rawId.startsWith('yt_') || detectedSource === 'youtube') {
          artistId = `yt_art_${item.artist.toLowerCase().replace(/\s+/g, '_')}`;
        }
        return {
          id: item.deezer_id,
          title: item.title,
          artist: {
            id: artistId,
            name: item.artist,
            picture: cover,
            source: detectedSource,
          },
          album: {
            id: item.album_id || undefined,
            title: item.album || '',
            cover_medium: cover,
            cover: cover,
            cover_big: cover,
            cover_xl: cover,
            cover_small: cover,
          },
          duration: item.duration || 180,
          preview: item.preview_url,
          source: detectedSource,
        };
      });
      setTracks(formatted);
    } catch (e) {
      console.error('Error loading liked tracks:', e);
    } finally {
      if (isCurrent()) setLoadingTracks(false);
    }
  }, [beginRead]);

  const loadSavedAlbums = useCallback(async () => {
    const isCurrent = beginRead('albums');
    if (!isCurrent()) return;
    setLoadingAlbums(true);
    try {
      const list: SavedAlbum[] = await platformBridge.getSavedAlbums();
      if (!isCurrent()) return;
      setSavedAlbums(list || []);
    } catch (e) {
      console.error('Error loading saved albums:', e);
    } finally {
      if (isCurrent()) setLoadingAlbums(false);
    }
  }, [beginRead]);

  const loadFollowedArtists = useCallback(async () => {
    const isCurrent = beginRead('artists');
    if (!isCurrent()) return;
    setLoadingArtists(true);
    try {
      const list: FollowedArtist[] = await platformBridge.getFollowedArtists();
      if (!isCurrent()) return;
      setFollowedArtists(list || []);
    } catch (e) {
      console.error('Error loading followed artists:', e);
    } finally {
      if (isCurrent()) setLoadingArtists(false);
    }
  }, [beginRead]);

  const loadListeningHistory = useCallback(async () => {
    const isCurrent = beginRead('history');
    if (!isCurrent()) return;
    setLoadingHistory(true);
    try {
      const list = await platformBridge.getListeningHistory(150, true);
      if (!isCurrent()) return;
      setHistoryItems(list || []);
    } catch (e) {
      console.error('Error loading listening history:', e);
    } finally {
      if (isCurrent()) setLoadingHistory(false);
    }
  }, [beginRead]);

  const loadOfflineTracks = useCallback(async () => {
    const isCurrent = beginRead('offline');
    if (!isCurrent()) return;
    setLoadingOffline(true);
    try {
      const items = await offlineCacheService.getAllCachedTracks();
      if (!isCurrent()) return;
      const mapped: Track[] = items.map((it) => ({
        id: it.trackId,
        title: it.title,
        artist: { name: it.artist },
        album: {
          id: 0,
          title: it.album || '',
          cover: it.coverUrl || '',
          cover_medium: it.coverUrl || '',
        },
        cover_url: it.coverUrl,
        duration: it.duration,
        preview: '',
        source: (it.source as any) || 'soundcloud',
      }));
      setOfflineTracks(mapped);
    } catch (e) {
      console.error('Error loading offline tracks:', e);
    } finally {
      if (isCurrent()) setLoadingOffline(false);
    }
  }, [beginRead]);

  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null);
  const [isClearHistoryConfirmOpen, setIsClearHistoryConfirmOpen] = useState<boolean>(false);

  const handleClearHistory = () => {
    setIsClearHistoryConfirmOpen(true);
  };

  const confirmClearHistory = async () => {
    const isCurrent = beginRead('clear-history');
    try {
      await platformBridge.clearListeningHistory();
      if (!isCurrent()) return;
      listReads.current.delete('history');
      setLoadingHistory(false);
      setHistoryItems([]);
      setIsClearHistoryConfirmOpen(false);
    } catch (e) {
      console.error('Error clearing history:', e);
      throw e;
    }
  };

  const cancelClearHistory = () => {
    setIsClearHistoryConfirmOpen(false);
  };

  const handleDeleteHistoryItem = (e: React.MouseEvent, id?: number) => {
    e.stopPropagation();
    if (!id) return;
    setHistoryItems((prev) => prev.filter((item) => item.id !== id));
  };

  const handleDeletePlaylist = (e: React.MouseEvent, playlistOrId: Playlist | string) => {
    e.stopPropagation();
    if (typeof playlistOrId === 'object' && playlistOrId) {
      setPlaylistToDelete(playlistOrId);
    } else {
      const found = playlists.find((p) => String(p.id) === String(playlistOrId));
      setPlaylistToDelete(found || { id: String(playlistOrId), name: 'Плейлист' });
    }
  };

  const confirmDeletePlaylist = async () => {
    if (!playlistToDelete) return;
    try {
      if (!(await platformBridge.deletePlaylist(playlistToDelete.id)))
        throw new Error('Не удалось удалить плейлист.');
      try {
        window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
      } catch {}
      if (!mounted.current) return;
      loadPlaylists();
      setPlaylistToDelete(null);
    } catch (e) {
      console.error('Error deleting playlist:', e);
      throw e;
    }
  };

  const cancelDeletePlaylist = () => {
    setPlaylistToDelete(null);
  };

  const handlePlayAllTracks = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks);
    }
  };

  const handlePlayAllOffline = () => {
    if (offlineTracks.length > 0) {
      playTrack(offlineTracks[0], offlineTracks);
    }
  };

  const handlePlayPlaylist = async (e: React.MouseEvent, playlist: Playlist) => {
    e.stopPropagation();
    try {
      const pTracks = await platformBridge.getPlaylistTracks(playlist.id);
      if (pTracks && pTracks.length > 0) {
        const formattedTracks: Track[] = pTracks.map((pt: any) => ({
          id: pt.track_deezer_id,
          title: pt.title,
          artist: { name: pt.artist, picture: pt.cover_url || '' },
          album: {
            id: 0,
            title: pt.album || '',
            cover: pt.cover_url || '',
            cover_medium: pt.cover_url || '',
            cover_big: pt.cover_url || '',
            cover_xl: pt.cover_url || '',
          },
          duration: pt.duration || 180,
          preview: pt.preview_url || '',
          source: detectTrackSource(pt),
        }));
        playTrack(formattedTracks[0], formattedTracks);
      }
    } catch (err) {
      console.error('Error playing playlist:', err);
    }
  };

  const totalDurationSeconds = useMemo(
    () => tracks.reduce((acc, t) => acc + (t.duration || 0), 0),
    [tracks],
  );

  useEffect(() => {
    loadPlaylists();
    return subscribePlaylistUpdates(loadPlaylists);
  }, [loadPlaylists, refreshPlaylistsTrigger]);

  useEffect(() => {
    loadLikedTracks();
  }, [loadLikedTracks, likedTrackIds]);

  useEffect(() => {
    loadSavedAlbums();
  }, [loadSavedAlbums, savedAlbumIds]);

  useEffect(() => {
    loadFollowedArtists();
  }, [loadFollowedArtists, followedArtistIds]);

  useEffect(() => {
    if (activeTab === 'history') {
      loadListeningHistory();
    }
  }, [activeTab, loadListeningHistory]);

  useEffect(() => {
    loadOfflineTracks();
  }, [loadOfflineTracks, cachedTrackIds, activeTab]);

  // Filtered queries
  const filteredTracks = useMemo(
    () => filterLibraryTracks(tracks, queryLower),
    [tracks, queryLower],
  );

  const filteredPlaylists = useMemo(() => {
    if (!queryLower) return playlists;
    return playlists.filter((pl) => {
      const nameMatch = pl.name?.toLowerCase().includes(queryLower);
      const descMatch = pl.description?.toLowerCase().includes(queryLower);
      return nameMatch || descMatch;
    });
  }, [playlists, queryLower]);

  const filteredSavedAlbums = useMemo(() => {
    if (!queryLower) return savedAlbums;
    return savedAlbums.filter((alb) => {
      const titleMatch = alb.title?.toLowerCase().includes(queryLower);
      const artistMatch = alb.artist_name?.toLowerCase().includes(queryLower);
      return titleMatch || artistMatch;
    });
  }, [savedAlbums, queryLower]);

  const filteredFollowedArtists = useMemo(() => {
    if (!queryLower) return followedArtists;
    return followedArtists.filter((art) => art.name?.toLowerCase().includes(queryLower));
  }, [followedArtists, queryLower]);

  const filteredOfflineTracks = useMemo(
    () => filterLibraryTracks(offlineTracks, queryLower),
    [offlineTracks, queryLower],
  );

  const filteredHistoryItems = useMemo(() => {
    if (!queryLower) return historyItems;
    return historyItems.filter((it) => {
      const titleMatch = it.title?.toLowerCase().includes(queryLower);
      const artistMatch = it.artist?.toLowerCase().includes(queryLower);
      const albumMatch = it.album?.toLowerCase().includes(queryLower);
      return titleMatch || artistMatch || albumMatch;
    });
  }, [historyItems, queryLower]);

  return {
    activeTab,
    setActiveTab,
    playlists,
    loadingPlaylists,
    loadPlaylists,
    tracks,
    loadingTracks,
    loadLikedTracks,
    savedAlbums,
    loadingAlbums,
    loadSavedAlbums,
    followedArtists,
    loadingArtists,
    loadFollowedArtists,
    historyItems,
    loadingHistory,
    loadListeningHistory,
    offlineTracks,
    loadingOffline,
    loadOfflineTracks,
    searchQuery,
    setSearchQuery,
    queryLower,
    filteredTracks,
    filteredPlaylists,
    filteredSavedAlbums,
    filteredFollowedArtists,
    filteredOfflineTracks,
    filteredHistoryItems,
    handleClearHistory,
    confirmClearHistory,
    cancelClearHistory,
    isClearHistoryConfirmOpen,
    handleDeleteHistoryItem,
    handleDeletePlaylist,
    playlistToDelete,
    confirmDeletePlaylist,
    cancelDeletePlaylist,
    handlePlayAllTracks,
    handlePlayAllOffline,
    handlePlayPlaylist,
    totalDurationSeconds,
    // Context pass-through
    playTrack,
    likedTrackIds,
    savedAlbumIds,
    followedArtistIds,
    toggleSaveAlbum,
    toggleFollowArtist,
    cachedTrackIds,
  };
}
