import { beginPlaybackIntent } from '../utils/playbackIntent.ts';
import { usePagedLibrary } from './usePagedLibrary';
import { mapLikedTracks } from '../utils/likedTrackMapping';
import type {
  LibraryKind,
  LibraryPage,
  LibraryPageRequest,
  LibrarySort,
  LibraryStats,
} from '../types/libraryPage';
import { subscribePlaylistUpdates } from '../utils/playlistEvents';
import { filterLibraryTracks } from '../utils/librarySearch.ts';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { ListeningHistoryItem, Playlist, Track } from '../types';
import { useAudioState, useAudioControls } from '../context/AudioContext';
import { platformBridge } from '../bridge/platformBridge';
import { offlineCacheService } from '../services/offlineCacheService';
import { detectTrackSource } from '../utils/formatters';

export type MyMusicTab = 'tracks' | 'playlists' | 'albums' | 'artists' | 'history' | 'offline';

export interface MyMusicViewModelProps {
  initialTab?: MyMusicTab;
  initialQuery?: string;
  refreshPlaylistsTrigger?: number;
  initialSort?: LibrarySort;
  initialLoadedCounts?: Partial<Record<LibraryKind, number>>;
}

const readLibraryPage = <K extends LibraryKind>(
  request: LibraryPageRequest<K>,
): Promise<LibraryPage<K>> => platformBridge.getLibraryPage(request);

export function useMyMusicViewModel({
  initialTab = 'tracks',
  initialQuery = '',
  refreshPlaylistsTrigger,
  initialSort = 'recent',
  initialLoadedCounts = {},
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

  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [sort, setSort] = useState<LibrarySort>(initialSort);
  const queryLower = searchQuery.trim().toLowerCase();
  const trackPage = usePagedLibrary({
    kind: 'tracks',
    query: searchQuery,
    sort,
    enabled: activeTab === 'tracks',
    initialCount: initialLoadedCounts.tracks,
    read: readLibraryPage,
  });
  const playlistPage = usePagedLibrary({
    kind: 'playlists',
    query: searchQuery,
    sort,
    enabled: activeTab === 'playlists',
    initialCount: initialLoadedCounts.playlists,
    read: readLibraryPage,
  });
  const albumPage = usePagedLibrary({
    kind: 'albums',
    query: searchQuery,
    sort,
    enabled: activeTab === 'albums',
    initialCount: initialLoadedCounts.albums,
    read: readLibraryPage,
  });
  const artistPage = usePagedLibrary({
    kind: 'artists',
    query: searchQuery,
    sort,
    enabled: activeTab === 'artists',
    initialCount: initialLoadedCounts.artists,
    read: readLibraryPage,
  });
  const tracks = useMemo(() => mapLikedTracks(trackPage.items), [trackPage.items]);
  const playlists = playlistPage.items,
    savedAlbums = albumPage.items,
    followedArtists = artistPage.items;
  const loadingTracks = trackPage.loading,
    loadingPlaylists = playlistPage.loading,
    loadingAlbums = albumPage.loading,
    loadingArtists = artistPage.loading;
  const loadLikedTracks = trackPage.refresh,
    loadPlaylists = playlistPage.refresh,
    loadSavedAlbums = albumPage.refresh,
    loadFollowedArtists = artistPage.refresh;
  const activePage =
    activeTab === 'tracks'
      ? trackPage
      : activeTab === 'playlists'
        ? playlistPage
        : activeTab === 'albums'
          ? albumPage
          : activeTab === 'artists'
            ? artistPage
            : undefined;
  const loadedCounts = useMemo(
    () => ({
      tracks: tracks.length,
      playlists: playlists.length,
      albums: savedAlbums.length,
      artists: followedArtists.length,
    }),
    [tracks.length, playlists.length, savedAlbums.length, followedArtists.length],
  );
  const [stats, setStats] = useState<LibraryStats>({
    tracks: 0,
    playlists: 0,
    albums: 0,
    artists: 0,
    durationSeconds: 0,
  });
  const [statsError, setStatsError] = useState<string | null>(null);
  const statsTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsGeneration = useRef(0);
  const refreshStats = useCallback(() => {
    const generation = ++statsGeneration.current;
    if (statsTimer.current !== null) clearTimeout(statsTimer.current);
    statsTimer.current = setTimeout(() => {
      statsTimer.current = null;
      void platformBridge.getLibraryStats().then(
        (value) => {
          if (mounted.current && generation === statsGeneration.current) {
            setStats(value);
            setStatsError(null);
          }
        },
        (error) => {
          if (mounted.current && generation === statsGeneration.current)
            setStatsError(String(error));
        },
      );
    }, 40);
  }, []);
  useEffect(
    () => () => {
      statsGeneration.current++;
      if (statsTimer.current !== null) clearTimeout(statsTimer.current);
    },
    [],
  );
  const [historyItems, setHistoryItems] = useState<ListeningHistoryItem[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [offlineTracks, setOfflineTracks] = useState<Track[]>([]);
  const [loadingOffline, setLoadingOffline] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const playGeneration = useRef(0);

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
      setPlaylistToDelete(null);
    } catch (e) {
      console.error('Error deleting playlist:', e);
      throw e;
    }
  };

  const cancelDeletePlaylist = () => {
    setPlaylistToDelete(null);
  };

  const handlePlayLibraryTrack = async (selected?: Track) => {
    const generation = ++playGeneration.current;
    const ownsIntent = beginPlaybackIntent();
    setPlaybackError(null);
    try {
      const context = mapLikedTracks(
        await platformBridge.getLibraryPlaybackTracks({ query: searchQuery, sort }),
      );
      if (!mounted.current || generation !== playGeneration.current || !ownsIntent()) return;
      const first = selected
        ? context.find((track) => String(track.id) === String(selected.id))
        : context[0];
      if (first) playTrack(first, context, false, undefined, { kind: 'library' });
      else if (selected) setPlaybackError('Трек больше не входит в эту подборку.');
    } catch (error) {
      if (mounted.current && generation === playGeneration.current) setPlaybackError(String(error));
    }
  };
  const handlePlayAllTracks = () => {
    void handlePlayLibraryTrack();
  };

  const handlePlayAllOffline = () => {
    if (offlineTracks.length > 0) {
      playTrack(offlineTracks[0], offlineTracks);
    }
  };

  const handlePlayPlaylist = async (e: React.MouseEvent, playlist: Playlist) => {
    e.stopPropagation();
    const ownsIntent = beginPlaybackIntent();
    try {
      const pTracks = await platformBridge.getPlaylistTracks(playlist.id);
      if (!mounted.current || !ownsIntent()) return;
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
        playTrack(formattedTracks[0], formattedTracks, false, undefined, {
          kind: 'playlist',
          id: String(playlist.id),
        });
      }
    } catch (err) {
      console.error('Error playing playlist:', err);
    }
  };

  const previousMembership = useRef({ likedTrackIds, savedAlbumIds, followedArtistIds });
  const previousRefreshTrigger = useRef(refreshPlaylistsTrigger);
  const totalDurationSeconds = stats.durationSeconds;
  useEffect(() => {
    const refreshAll = () => {
      loadPlaylists();
      loadLikedTracks();
      loadSavedAlbums();
      loadFollowedArtists();
      refreshStats();
    };
    if (previousRefreshTrigger.current !== refreshPlaylistsTrigger) refreshAll();
    else refreshStats();
    previousRefreshTrigger.current = refreshPlaylistsTrigger;
    return subscribePlaylistUpdates(refreshAll);
  }, [
    loadPlaylists,
    loadLikedTracks,
    loadSavedAlbums,
    loadFollowedArtists,
    refreshStats,
    refreshPlaylistsTrigger,
  ]);
  useEffect(() => {
    if (previousMembership.current.likedTrackIds !== likedTrackIds) {
      previousMembership.current.likedTrackIds = likedTrackIds;
      loadLikedTracks();
    }
    refreshStats();
  }, [loadLikedTracks, likedTrackIds, refreshStats]);
  useEffect(() => {
    if (previousMembership.current.savedAlbumIds !== savedAlbumIds) {
      previousMembership.current.savedAlbumIds = savedAlbumIds;
      loadSavedAlbums();
    }
    refreshStats();
  }, [loadSavedAlbums, savedAlbumIds, refreshStats]);
  useEffect(() => {
    if (previousMembership.current.followedArtistIds !== followedArtistIds) {
      previousMembership.current.followedArtistIds = followedArtistIds;
      loadFollowedArtists();
    }
    refreshStats();
  }, [loadFollowedArtists, followedArtistIds, refreshStats]);
  useEffect(() => {
    if (activeTab === 'history') loadListeningHistory();
  }, [activeTab, loadListeningHistory]);
  useEffect(() => {
    if (activeTab === 'offline') loadOfflineTracks();
  }, [activeTab, loadOfflineTracks, cachedTrackIds]);

  // Query is applied in DB before LIMIT, never a filter of the loaded prefix.
  const filteredTracks = tracks,
    filteredPlaylists = playlists,
    filteredSavedAlbums = savedAlbums,
    filteredFollowedArtists = followedArtists;

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
    sort,
    setSort,
    loadedCounts,
    stats,
    statsError,
    refreshStats,
    activePage,
    playbackError,
    handlePlayLibraryTrack,
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
