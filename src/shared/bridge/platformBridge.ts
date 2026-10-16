import { invokeStreamRequest } from '../utils/streamRequest.ts';
import { waveAbortError } from '../services/waveRequestScheduler.ts';

import type { PlaylistReadResult } from '../types/playlistImport.ts';
import type { WaveBatchContext } from '../types/index.ts';
import type {
  ArtistDetails,
  AutocompleteSuggestion,
  ChartData,
  Genre,
  GuitarChordData,
  LanSyncSession,
  LikedTrack,
  ListeningStats,
  LyricsLine,
  MusicSource,
  PlaybackSessionUpdate,
  Playlist,
  PlaylistTrack,
  SavedAlbum,
  SearchHistoryItem,
  SmartPlaylistKind,
  SmartPlaylistTrack,
  SongsterrTabData,
  StreamResolveOptions,
  Track,
  WaveMood,
} from '../types/index.ts';

// Store reference to genuine Electron preload API if it exists before polyfilling
const nativeElectron: any =
  typeof window !== 'undefined' &&
  (window as any).electronAPI &&
  !(window as any).electronAPI._isPlatformBridge
    ? (window as any).electronAPI
    : null;

export const isElectron = Boolean(nativeElectron);
let waveBatchRequestSequence = 0;

export const platformBridge = {
  getTastePolicy: async (): Promise<import('../types/tastePolicy.ts').TastePolicySnapshot> => {
    if (!nativeElectron?.getTastePolicy) throw new Error('Desktop preload API is unavailable');
    return nativeElectron.getTastePolicy();
  },
  setTasteExcluded: async (
    value: import('../types/tastePolicy.ts').TasteExclusionChange,
  ): Promise<import('../types/tastePolicy.ts').TastePolicySnapshot> => {
    if (!nativeElectron?.setTasteExcluded) throw new Error('Desktop preload API is unavailable');
    return nativeElectron.setTasteExcluded(value);
  },
  getTasteProfile: async (): Promise<{
    revision: number;
    likes: LikedTrack[];
    artists: { name: string; id?: string | number; score?: number }[];
  }> => {
    if (!nativeElectron?.getTasteProfile) throw new Error('Desktop preload API is unavailable');
    return nativeElectron.getTasteProfile();
  },
  onTastePolicyChanged: (
    callback: (value: import('../types/tastePolicy.ts').TastePolicySnapshot) => void,
  ): (() => void) => nativeElectron?.onTastePolicyChanged?.(callback) || (() => {}),
  _isPlatformBridge: true,

  readExternalPlaylist: async (url: string): Promise<PlaylistReadResult> => {
    if (nativeElectron?.readExternalPlaylist) return nativeElectron.readExternalPlaylist(url);
    throw new Error('Desktop preload API is unavailable');
  },
  canOpenVkImportWindow: Boolean(nativeElectron?.readVkPlaylistInWindow),
  readVkPlaylistInWindow: async (url: string): Promise<PlaylistReadResult> => {
    if (nativeElectron?.readVkPlaylistInWindow) return nativeElectron.readVkPlaylistInWindow(url);
    return {
      success: false,
      code: 'access',
      error:
        'Для входа в VK выполните импорт на ПК, затем перенесите медиатеку на телефон через синхронизацию.',
    };
  },
  cancelVkPlaylistRead: async (): Promise<void> => {
    await nativeElectron?.cancelVkPlaylistRead?.();
  },

  // Window controls
  minimizeWindow: () => nativeElectron?.minimizeWindow?.(),
  maximizeWindow: () => nativeElectron?.maximizeWindow?.(),
  closeWindow: () => nativeElectron?.closeWindow?.(),
  isWindowMaximized: async () => nativeElectron?.isWindowMaximized?.() ?? false,

  // Music API & Stream
  search: async (
    query: string,
    limit?: number,
    source?: MusicSource,
  ): Promise<{ data: Track[]; total?: number }> => {
    if (nativeElectron?.search) {
      return nativeElectron.search(query, limit, source);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  searchArtists: async (
    query: string,
    limit?: number,
    source?: MusicSource,
  ): Promise<{ data: any[] }> => {
    if (nativeElectron?.searchArtists) {
      return nativeElectron.searchArtists(query, limit, source);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getCharts: async (source?: MusicSource): Promise<ChartData> => {
    if (nativeElectron?.getCharts) {
      return nativeElectron.getCharts(source);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getGenres: async (): Promise<{ data: Genre[] }> => {
    if (nativeElectron?.getGenres) {
      return nativeElectron.getGenres();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getGenreTracks: async (
    genreId: number | string,
    source?: MusicSource,
  ): Promise<{ data: Track[] }> => {
    if (nativeElectron?.getGenreTracks) {
      return nativeElectron.getGenreTracks(genreId, source);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getAutocomplete: async (query: string): Promise<AutocompleteSuggestion[]> => {
    if (nativeElectron?.getAutocomplete) {
      return nativeElectron.getAutocomplete(query);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getArtist: async (
    idOrName: string | number,
    artistName?: string,
    artistSource?: string,
  ): Promise<ArtistDetails | null> => {
    if (nativeElectron?.getArtist) {
      return nativeElectron.getArtist(idOrName, artistName, artistSource);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getArtistAllTracks: async (
    idOrName: string | number,
    artistName?: string,
    artistSource?: string,
  ): Promise<Track[]> => {
    if (nativeElectron?.getArtistAllTracks) {
      return nativeElectron.getArtistAllTracks(idOrName, artistName, artistSource);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getAlbumTracks: async (
    albumId?: string | number,
    albumTitle?: string,
    artistName?: string,
  ): Promise<Track[]> => {
    if (nativeElectron?.getAlbumTracks) {
      return nativeElectron.getAlbumTracks(albumId, albumTitle, artistName);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getWaveBatch: async (
    mood?: WaveMood,
    seedTracks?: any[],
    excludeIds?: any[],
    context?: WaveBatchContext,
    signal?: AbortSignal,
  ): Promise<Track[]> => {
    signal?.throwIfAborted();
    if (!nativeElectron?.getWaveBatch) throw new Error('Desktop preload API is unavailable');
    const requestId =
      signal && nativeElectron.cancelWaveBatch
        ? 'wave-' + Date.now() + '-' + ++waveBatchRequestSequence
        : undefined;
    const cancel = () => {
      if (requestId)
        void Promise.resolve(nativeElectron.cancelWaveBatch(requestId)).catch(() => {});
    };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      const result = await nativeElectron.getWaveBatch(
        mood,
        seedTracks,
        excludeIds,
        context,
        requestId,
      );
      if (signal?.aborted) throw waveAbortError();
      return result;
    } finally {
      signal?.removeEventListener('abort', cancel);
    }
  },

  getFullStreamUrl: async (
    track: Track,
    options?: StreamResolveOptions,
    signal?: AbortSignal,
  ): Promise<string> => {
    if (nativeElectron?.getFullStreamUrl) {
      return invokeStreamRequest(
        (requestId) => nativeElectron.getFullStreamUrl(track, options, requestId),
        nativeElectron.cancelStreamResolve
          ? (requestId) => nativeElectron.cancelStreamResolve(requestId)
          : undefined,
        signal,
      );
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Lyrics & Chords API
  getLyrics: async (
    title: string,
    artist: string,
    duration?: number,
  ): Promise<LyricsLine[] | null> => {
    if (nativeElectron?.getLyrics) {
      return nativeElectron.getLyrics(title, artist, duration);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getChords: async (payload: {
    title: string;
    artist: string;
  }): Promise<GuitarChordData | null> => {
    if (nativeElectron?.getChords) {
      return nativeElectron.getChords(payload);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getSongsterrTab: async (payload: {
    title: string;
    artist: string;
  }): Promise<SongsterrTabData | null> => {
    if (nativeElectron?.getSongsterrTab) {
      return nativeElectron.getSongsterrTab(payload);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getOfficialVideoClip: async (
    artist: string,
    title: string,
    apiKey?: string,
  ): Promise<string | null> => {
    if (nativeElectron?.getOfficialVideoClip) {
      return nativeElectron.getOfficialVideoClip(artist, title, apiKey);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getVideoStream: async (
    videoId: string,
    options?: Pick<StreamResolveOptions, 'forceRefresh'>,
  ): Promise<string> => {
    if (nativeElectron?.getVideoStream) {
      return nativeElectron.getVideoStream(videoId, options);
    }
    return '';
  },

  getLibraryPage: async <K extends import('../types/libraryPage').LibraryKind>(
    request: import('../types/libraryPage').LibraryPageRequest<K>,
  ): Promise<import('../types/libraryPage').LibraryPage<K>> => {
    if (nativeElectron?.getLibraryPage) return nativeElectron.getLibraryPage(request);
    throw new Error('Desktop preload API is unavailable');
  },
  getLibraryStats: async (): Promise<import('../types/libraryPage').LibraryStats> => {
    if (nativeElectron?.getLibraryStats) return nativeElectron.getLibraryStats();
    throw new Error('Desktop preload API is unavailable');
  },
  getLibraryPlaybackTracks: async (
    request: import('../types/libraryPage').LibraryPlaybackRequest,
  ): Promise<LikedTrack[]> => {
    if (nativeElectron?.getLibraryPlaybackTracks)
      return nativeElectron.getLibraryPlaybackTracks(request);
    throw new Error('Desktop preload API is unavailable');
  },
  getSavedAlbumIds: async (): Promise<string[]> => {
    if (nativeElectron?.getSavedAlbumIds) return nativeElectron.getSavedAlbumIds();
    throw new Error('Desktop preload API is unavailable');
  },
  getArtistMembership: async (): Promise<import('../types/libraryPage').ArtistMembership[]> => {
    if (nativeElectron?.getArtistMembership) return nativeElectron.getArtistMembership();
    throw new Error('Desktop preload API is unavailable');
  },

  // SQLite - Liked Tracks
  getLikedTrackIds: async (): Promise<string[]> => {
    if (nativeElectron?.getLikedTrackIds) return nativeElectron.getLikedTrackIds();
    // Support older desktop preloads that expose only full liked tracks.
    const tracks = nativeElectron?.getLikedTracks ? await nativeElectron.getLikedTracks() : [];
    return (tracks || []).map((track: LikedTrack) => String(track.deezer_id));
  },

  getLikedTracks: async (): Promise<LikedTrack[]> => {
    if (nativeElectron?.getLikedTracks) {
      return nativeElectron.getLikedTracks();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  isTrackLiked: async (deezerId: string | number): Promise<boolean> => {
    if (nativeElectron?.isTrackLiked) {
      return nativeElectron.isTrackLiked(deezerId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  toggleLikeTrack: async (track: Track): Promise<boolean> => {
    if (nativeElectron?.toggleLikeTrack) {
      return nativeElectron.toggleLikeTrack(track);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Saved Albums
  getSavedAlbums: async (): Promise<SavedAlbum[]> => {
    if (nativeElectron?.getSavedAlbums) {
      return nativeElectron.getSavedAlbums();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  isAlbumSaved: async (albumId: string | number): Promise<boolean> => {
    if (nativeElectron?.isAlbumSaved) {
      return nativeElectron.isAlbumSaved(albumId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  toggleSaveAlbum: async (album: any): Promise<boolean> => {
    if (nativeElectron?.toggleSaveAlbum) {
      return nativeElectron.toggleSaveAlbum(album);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Followed Artists
  getFollowedArtists: async (): Promise<any[]> => {
    if (nativeElectron?.getFollowedArtists) {
      return nativeElectron.getFollowedArtists();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  isArtistFollowed: async (artistId: string | number): Promise<boolean> => {
    if (nativeElectron?.isArtistFollowed) {
      return nativeElectron.isArtistFollowed(artistId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  toggleFollowArtist: async (artist: any): Promise<boolean> => {
    if (nativeElectron?.toggleFollowArtist) {
      return nativeElectron.toggleFollowArtist(artist);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Playlists
  getPlaylists: async (): Promise<Playlist[]> => {
    if (nativeElectron?.getPlaylists) {
      return nativeElectron.getPlaylists();
    }
    throw new Error('Desktop preload API is unavailable');
  },
  getTrackPlaylistIds: async (trackId: string | number): Promise<string[]> => {
    if (nativeElectron?.getTrackPlaylistIds) return nativeElectron.getTrackPlaylistIds(trackId);
    throw new Error('Desktop preload API is unavailable');
  },

  createPlaylist: async (name: string, description?: string): Promise<string> => {
    if (nativeElectron?.createPlaylist) {
      return nativeElectron.createPlaylist(name, description);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  setPlaylistCover: async (playlistId: string, coverUrl: string): Promise<boolean> => {
    if (nativeElectron?.setPlaylistCover)
      return nativeElectron.setPlaylistCover(playlistId, coverUrl);
    throw new Error('Desktop preload API is unavailable');
  },

  deletePlaylist: async (playlistId: string): Promise<boolean> => {
    if (nativeElectron?.deletePlaylist) {
      return nativeElectron.deletePlaylist(playlistId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getPlaylistTracks: async (playlistId: string): Promise<PlaylistTrack[]> => {
    if (nativeElectron?.getPlaylistTracks) {
      return nativeElectron.getPlaylistTracks(playlistId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  addTrackToPlaylist: async (playlistId: string, track: Track): Promise<boolean> => {
    const success = await (nativeElectron?.addTrackToPlaylist
      ? nativeElectron.addTrackToPlaylist(playlistId, track)
      : Promise.reject(new Error('Desktop preload API is unavailable')));
    if (success)
      window.dispatchEvent(new CustomEvent('soso:playlists-updated', { detail: { playlistId } }));
    return success;
  },

  removeTrackFromPlaylist: async (
    playlistId: string,
    trackDeezerId: string | number,
  ): Promise<boolean> => {
    const success = await (nativeElectron?.removeTrackFromPlaylist
      ? nativeElectron.removeTrackFromPlaylist(playlistId, trackDeezerId)
      : Promise.reject(new Error('Desktop preload API is unavailable')));
    if (success)
      window.dispatchEvent(new CustomEvent('soso:playlists-updated', { detail: { playlistId } }));
    return success;
  },

  // Search History
  getSearchHistory: async (limit?: number): Promise<SearchHistoryItem[]> => {
    if (nativeElectron?.getSearchHistory) {
      return nativeElectron.getSearchHistory(limit);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  addSearchHistory: async (query: string): Promise<boolean> => {
    if (nativeElectron?.addSearchHistory) {
      return nativeElectron.addSearchHistory(query);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  clearSearchHistory: async (): Promise<boolean> => {
    if (nativeElectron?.clearSearchHistory) {
      return nativeElectron.clearSearchHistory();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  removeSearchHistoryItem: async (id: number): Promise<boolean> => {
    if (nativeElectron?.removeSearchHistoryItem) {
      return nativeElectron.removeSearchHistoryItem(id);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Scrobbles & Dislikes
  recordScrobble: async (data: {
    track: any;
    completed?: boolean;
    skipped?: boolean;
    repeated?: boolean;
  }): Promise<boolean> => {
    if (nativeElectron?.recordScrobble) {
      return nativeElectron.recordScrobble(data);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  recordPlaybackSession: async (data: PlaybackSessionUpdate): Promise<void> => {
    if (nativeElectron?.recordPlaybackSession) {
      return nativeElectron.recordPlaybackSession(data);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  dislikeTrack: async (track: any): Promise<boolean> => {
    if (nativeElectron?.dislikeTrack) {
      return nativeElectron.dislikeTrack(track);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  undislikeTrack: async (trackId: string | number): Promise<boolean> => {
    if (nativeElectron?.undislikeTrack) {
      return nativeElectron.undislikeTrack(trackId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  isDisliked: async (trackId: string | number): Promise<boolean> => {
    if (nativeElectron?.isDisliked) {
      return nativeElectron.isDisliked(trackId);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getDislikedTrackIds: async (): Promise<string[]> => {
    if (nativeElectron?.getDislikedTrackIds) {
      return nativeElectron.getDislikedTrackIds();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getTopScrobbledTracks: async (limit?: number): Promise<any[]> => {
    if (nativeElectron?.getTopScrobbledTracks) {
      return nativeElectron.getTopScrobbledTracks(limit);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getTopScrobbledArtists: async (limit?: number): Promise<{ name: string; score: number }[]> => {
    if (nativeElectron?.getTopScrobbledArtists) {
      return nativeElectron.getTopScrobbledArtists(limit);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Listening History
  addListeningHistory: async (track: any): Promise<void> => {
    if (nativeElectron?.addListeningHistory) {
      return nativeElectron.addListeningHistory(track);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getListeningHistory: async (limit?: number, uniqueTracks = false): Promise<any[]> => {
    if (nativeElectron?.getListeningHistory) {
      return nativeElectron.getListeningHistory(limit, uniqueTracks);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  clearListeningHistory: async (): Promise<void> => {
    if (nativeElectron?.clearListeningHistory) {
      return nativeElectron.clearListeningHistory();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getStats: async (): Promise<ListeningStats> => {
    if (nativeElectron?.getStats) {
      return nativeElectron.getStats();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  getSmartPlaylist: async (kind: SmartPlaylistKind): Promise<SmartPlaylistTrack[]> => {
    if (nativeElectron?.getSmartPlaylist) {
      return nativeElectron.getSmartPlaylist(kind);
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Discord Rich Presence (Desktop only)
  updateDiscordRpc: async (data: any) => {
    if (nativeElectron?.updateDiscordRpc) {
      return nativeElectron.updateDiscordRpc(data);
    }
  },

  clearDiscordRpc: async () => {
    if (nativeElectron?.clearDiscordRpc) {
      return nativeElectron.clearDiscordRpc();
    }
  },

  toggleDiscordRpc: async (enabled: boolean) => {
    if (nativeElectron?.toggleDiscordRpc) {
      return nativeElectron.toggleDiscordRpc(enabled);
    }
  },

  // Desktop Mini-Widget (Desktop only)
  toggleWidget: async (): Promise<boolean> => {
    if (nativeElectron?.toggleWidget) {
      return nativeElectron.toggleWidget();
    }
    return false;
  },

  isWidgetOpen: async (): Promise<boolean> => {
    if (nativeElectron?.isWidgetOpen) {
      return nativeElectron.isWidgetOpen();
    }
    return false;
  },

  sendWidgetState: (state: any) => {
    if (nativeElectron?.sendWidgetState) {
      nativeElectron.sendWidgetState(state);
    }
  },

  sendWidgetCommand: (command: string, data?: any) => {
    if (nativeElectron?.sendWidgetCommand) {
      nativeElectron.sendWidgetCommand(command, data);
    }
  },

  onWidgetCommand: (callback: (command: string, data?: any) => void) => {
    if (nativeElectron?.onWidgetCommand) {
      return nativeElectron.onWidgetCommand(callback);
    }
    return () => {};
  },

  onWidgetStateUpdate: (callback: (state: any) => void) => {
    if (nativeElectron?.onWidgetStateUpdate) {
      return nativeElectron.onWidgetStateUpdate(callback);
    }
    return () => {};
  },

  // Backup & Restore
  exportDatabase: async (): Promise<any> => {
    if (nativeElectron?.exportDatabase) {
      return nativeElectron.exportDatabase();
    }
    throw new Error('Desktop preload API is unavailable');
  },

  startLanSync: async (): Promise<LanSyncSession> =>
    nativeElectron?.startLanSync?.() ?? { active: false, addresses: [] },
  stopLanSync: async (): Promise<LanSyncSession> =>
    nativeElectron?.stopLanSync?.() ?? { active: false, addresses: [] },
  getLanSyncStatus: async (): Promise<LanSyncSession> =>
    nativeElectron?.getLanSyncStatus?.() ?? { active: false, addresses: [] },
  onLanSyncImported: (callback: () => void): (() => void) =>
    nativeElectron?.onLanSyncImported?.(callback) ?? (() => {}),

  importDatabase: async (jsonOrPath?: string): Promise<any> => {
    if (nativeElectron?.importDatabase) {
      return nativeElectron.importDatabase();
    }
    if (!jsonOrPath || !jsonOrPath.trim()) {
      return { success: false, message: 'Данные для импорта не указаны' };
    }
    throw new Error('Desktop preload API is unavailable');
  },

  // Diagnostics & Logs
  openLogFile: async (): Promise<{ success: boolean; filePath?: string; error?: string }> => {
    if (nativeElectron?.openLogFile) {
      return nativeElectron.openLogFile();
    }
    return {
      success: false,
      error: 'Просмотр файлов логов доступен в десктопной версии приложения',
    };
  },
};
