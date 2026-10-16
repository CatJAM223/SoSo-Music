import type {
  DesktopControlsStatus,
  ShortcutAction,
  OverlayLayout,
} from '../utils/desktopControls';
import type { PlaybackOrigin, TasteExclusionChange, TastePolicySnapshot } from './tastePolicy.ts';
import type { LibraryTasteReport } from './libraryTaste.ts';
import type { PlaylistReadResult } from './playlistImport.ts';

export type MusicSource = 'all' | 'soundcloud' | 'youtube';

export interface Track {
  id: number | string;
  /** Queue occurrence provenance, separate from provider recording identity. */
  queueOrigin?: PlaybackOrigin;
  title: string;
  title_short?: string;
  artist: {
    id?: number | string;
    name: string;
    picture?: string;
    picture_medium?: string;
    source?: 'soundcloud' | 'youtube' | 'deezer';
  };
  album: {
    id?: number | string;
    title: string;
    cover?: string;
    cover_small?: string;
    cover_medium?: string;
    cover_big?: string;
    cover_xl?: string;
  };
  duration: number; // in seconds
  preview: string; // audio stream URL (full stream or preview)
  resolvedStreamUrl?: string;
  resolvedStreamTimestamp?: number;
  source?: 'soundcloud' | 'youtube' | 'deezer';
  cover_url?: string;
  /** SoundCloud classification metadata used for genre browsing. */
  genre?: string;
  tags?: string[];
  /** Provider metadata explicitly offers no format supported by this player. */
  playbackUnavailable?: boolean;
  /** Ephemeral wave taste strength; never a playback URL or stored rating. */
  waveSeedWeight?: number;
  /** Ephemeral relevance within a provider song radio, normalized to 0..1. */
  waveRadioScore?: number;
  /** Library genre affinity carried to renderer queue refinement, bounded to -2..6. */
  waveGenreScore?: number;
}

export interface StreamResolveOptions {
  /** Only active playback may reset a challenged YouTube session; speculative prefetch stays inert. */
  allowSessionRecovery?: boolean;
  /** Bypass per-process caches after the media element rejects a signed stream URL. */
  forceRefresh?: boolean;
  /** Try another audio format of the same YouTube video after a refreshed stream fails. */
  preferAlternateFormat?: boolean;
  /** The format rejected by the media element, when it can be read from the stream URL. */
  excludeItag?: number;
}

/** Small, serializable listening context for recommendation retrieval. */
export interface WaveBatchContext {
  tasteRevision?: number;
  /** Providers allowed for this wave, independent of its mood. */
  source?: MusicSource;
  /** Songs with measured listening time, never merely generated candidates. */
  recentTracks?: Track[];
  /** Short-lived exposure hint. These songs remain eligible if no better match exists. */
  offeredTracks?: Track[];
  artistFeedback?: Record<string, number>;
  /** Most recent successful and skipped songs, newest first; these are session hints. */
  positiveTracks?: Track[];
  skippedTracks?: Track[];
  /** Confirmed, locally learned affinities, separate from current-session reactions. */
  learnedTracks?: Track[];
  /** Bounded adjustment of novelty based on recent unfamiliar-track reactions. */
  discoveryAdjustment?: number;
}

export interface LikedTrack {
  id?: number;
  deezer_id: string;
  title: string;
  artist: string;
  album: string;
  album_id?: string;
  cover_url: string;
  preview_url: string;
  duration: number;
  source?: 'soundcloud' | 'youtube' | 'deezer';
  liked_at?: string;
  created_at?: string;
}

export interface Playlist {
  id: string;
  name: string;
  description?: string;
  cover_url?: string;
  created_at?: string;
  updated_at?: string;
  track_count?: number;
}

export interface PlaylistTrack {
  id: number;
  playlist_id: string;
  track_deezer_id: string;
  title: string;
  artist: string;
  album: string;
  cover_url: string;
  preview_url: string;
  duration: number;
  source?: 'soundcloud' | 'deezer' | 'youtube';
  added_at: string;
}

export interface SearchHistoryItem {
  id: number;
  query: string;
  searched_at: string;
}

export interface Genre {
  id: number;
  name: string;
  picture?: string;
  picture_medium?: string;
  picture_big?: string;
}

export interface Artist {
  id: number | string;
  name: string;
  picture?: string;
  picture_medium?: string;
  picture_big?: string;
  picture_xl?: string;
  nb_album?: number;
  nb_fan?: number;
  source?: 'soundcloud' | 'deezer' | 'youtube';
}

export interface Album {
  id: number | string;
  title: string;
  cover?: string;
  cover_medium?: string;
  cover_big?: string;
  cover_xl?: string;
  release_date?: string;
  record_type?: string;
  track_count?: number;
  artist?: {
    id?: number | string;
    name: string;
  };
  artist_name?: string;
  source?: 'soundcloud' | 'deezer' | 'youtube';
}

export interface SavedAlbum {
  id: number | string;
  album_id?: string;
  title: string;
  artist_name: string;
  artist_id?: number | string;
  cover_url: string;
  release_date?: string;
  record_type?: string;
  track_count?: number;
  saved_at?: string;
}

export interface ArtistDetails {
  artist: Artist;
  topTracks: Track[];
  albums: Album[];
  bio?: string;
  similarArtists?: { id: string | number; name: string; picture?: string; stat?: string }[];
  stats?: { listeners?: string | number; playcount?: string | number };
}

export interface ChartData {
  tracks: { data: Track[] };
  albums?: { data: any[] };
  artists?: { data: any[] };
  playlists?: { data: any[] };
}

export interface AutocompleteSuggestion {
  id: number | string;
  title: string;
  artist: string;
  type: 'track' | 'artist' | 'album';
  source?: 'soundcloud' | 'deezer' | 'youtube';
  picture?: string;
}

export type RepeatMode = 'off' | 'all' | 'one';

export interface FollowedArtist {
  id: string | number;
  name: string;
  picture_url?: string;
  followed_at?: string;
}

export interface DatabaseBackupStats {
  tracks: number;
  albums: number;
  artists?: number;
  playlists: number;
  playlistTracks: number;
}

export interface DatabaseExportResult {
  success: boolean;
  canceled?: boolean;
  filePath?: string;
  error?: string;
  message?: string;
  stats?: DatabaseBackupStats;
}

export interface DatabaseImportResult {
  success: boolean;
  canceled?: boolean;
  error?: string;
  message?: string;
  stats?: DatabaseBackupStats;
}

export interface LanImportRequest {
  id: string;
  address: string;
  tracks: number;
  playlists: number;
  albums: number;
  artists: number;
}

export interface LanSyncSession {
  active: boolean;
  addresses: string[];
  code?: string;
  port?: number;
}

export interface DatabaseBackup {
  version: number;
  app: string;
  exported_at: string;
  data: {
    liked_tracks: LikedTrack[];
    saved_albums: SavedAlbum[];
    followed_artists?: FollowedArtist[];
    playlists: Playlist[];
    playlist_tracks: PlaylistTrack[];
    search_history?: SearchHistoryItem[];
  };
}

export type WaveMood = 'default' | 'energy' | 'chill' | 'discover' | 'mix' | 'favorites';

export type SmartPlaylistKind = 'top' | 'recent' | 'forgotten' | 'repeat';

export interface SmartPlaylistTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  cover_url: string;
  preview_url: string;
  duration: number;
  play_count: number;
}

export interface ListeningStats {
  totalPlays: number;
  uniqueTracks: number;
  uniqueArtists: number;
  likedCount: number;
  approxHours: number;
  approxMinutes?: number;
  measuredSeconds?: number;
  totalRepeats?: number;
  totalCompletions?: number;
  completionRate?: number;
  mostReplayedTrack?: {
    id: string;
    title: string;
    artist: string;
    cover_url: string;
    repeat_count: number;
  } | null;
  topTracks: {
    id: string;
    title: string;
    artist: string;
    cover_url: string;
    play_count: number;
  }[];
  topArtists: {
    artist: string;
    plays: number;
    sharePercent?: number;
    picture_url?: string;
  }[];
  activity: {
    day: string;
    plays: number;
  }[];
  todaySeconds?: number;
  weekly?: {
    plays: number;
    measuredSeconds: number;
    uniqueTracks: number;
    uniqueArtists: number;
    completions: number;
    repeats: number;
    likes: number;
    topTracks: ListeningStats['topTracks'];
    topArtists: ListeningStats['topArtists'];
    activity: { day: string; plays: number; measuredSeconds: number }[];
  };
}

export interface PlaybackSessionUpdate {
  sessionId: string;
  origin?: PlaybackOrigin;
  track: Track;
  playedSeconds: number;
  completed?: boolean;
  skipped?: boolean;
  repeated?: boolean;
}

export interface TrackScrobble {
  track_id: string;
  title: string;
  artist: string;
  play_count: number;
  complete_count: number;
  skip_count: number;
  repeat_count: number;
  last_played_at?: string;
}

export interface DislikedTrack {
  track_id: string;
  title: string;
  artist: string;
  disliked_at?: string;
}

export interface ListeningHistoryItem {
  id?: number;
  track_id: string;
  title: string;
  artist: string;
  album?: string;
  cover_url?: string;
  source?: 'soundcloud' | 'deezer' | 'youtube';
  duration?: number;
  played_at?: string;
}

export interface LyricsLine {
  time: number; // seconds
  text: string;
}

export interface GuitarChordData {
  title: string;
  artist: string;
  key?: string;
  tuning?: string;
  capo?: number;
  difficulty?: string;
  rating?: number;
  votes?: number;
  tabUrl?: string;
  source: 'ultimate-guitar' | 'amdm' | 'custom';
  rawContent: string;
}

export interface SongsterrTrack {
  instrumentId?: number;
  instrument: string;
  name: string;
  tuning: string;
  rawTuning?: number[];
  difficulty?: number;
  views?: number;
}

export interface SongsterrTabData {
  songId: number;
  artistId?: number;
  title: string;
  artist: string;
  hasPlayer: boolean;
  hasChords: boolean;
  tracks: SongsterrTrack[];
  defaultTrackIndex: number;
  songsterrUrl: string;
}

export interface WidgetState {
  track: Track | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  isLiked: boolean;
  volume?: number;
}

export interface YouTubeAccountStatus {
  connected: boolean;
  loginOpen: boolean;
  error?: string;
}

export type AppUpdateStatus = {
  status: 'up-to-date' | 'available' | 'no-release' | 'error';
  currentVersion: string;
  latestVersion?: string;
  releaseUrl?: string;
  retryAfterMs?: number;
  message: string;
};
export type LibraryPersistenceStatus = { state: 'ready' | 'recovered' | 'error'; message?: string };
export interface ElectronAPI {
  getAvailableAppUpdate?: () => Promise<AppUpdateStatus | null>;
  onAppUpdateAvailable?: (callback: (status: AppUpdateStatus) => void) => () => void;
  getDesktopControls?: () => Promise<DesktopControlsStatus>;
  setDesktopShortcut?: (action: ShortcutAction, key: string) => Promise<DesktopControlsStatus>;
  captureDesktopShortcut?: (enabled: boolean) => Promise<DesktopControlsStatus>;
  togglePlayerOverlay?: () => Promise<boolean>;
  setPlayerOverlayEnabled?: (enabled: boolean) => Promise<DesktopControlsStatus>;
  getOverlayState?: () => Promise<WidgetState | null>;
  getOverlayLayout?: () => Promise<OverlayLayout>;
  saveOverlayLayout?: (layout: OverlayLayout) => Promise<OverlayLayout>;
  editPlayerOverlay?: () => Promise<boolean>;
  getOverlayEditing?: () => Promise<boolean>;
  finishOverlayEditing?: () => Promise<boolean>;
  onOverlayEditingChanged?: (callback: (editing: boolean) => void) => () => void;
  getLastFmApiKeyStatus?: () => Promise<{ configured: boolean }>;
  saveLastFmApiKey?: (key: string) => Promise<{ configured: boolean }>;
  setInterfaceLanguage?: (language: 'ru' | 'en') => Promise<void>;
  getTastePolicy?: () => Promise<TastePolicySnapshot>;
  setTasteExcluded?: (value: TasteExclusionChange) => Promise<TastePolicySnapshot>;
  getTasteProfile?: () => Promise<{
    revision: number;
    likes: LikedTrack[];
    artists: { name: string; id?: string | number; score?: number }[];
  }>;
  onTastePolicyChanged?: (callback: (policy: TastePolicySnapshot) => void) => () => void;
  getLibraryTaste?: () => Promise<LibraryTasteReport>;
  analyzeLibraryTaste?: () => Promise<LibraryTasteReport>;
  cancelLibraryTaste?: () => Promise<LibraryTasteReport>;
  setLibraryTasteAutoAnalyze?: (enabled: boolean) => Promise<LibraryTasteReport>;
  getLibraryPersistenceStatus?: () => Promise<LibraryPersistenceStatus>;
  onLibraryPersistenceStatus?: (callback: (status: LibraryPersistenceStatus) => void) => () => void;
  checkAppUpdates?: () => Promise<AppUpdateStatus>;
  getYouTubeAccountStatus?: () => Promise<YouTubeAccountStatus>;
  connectYouTubeAccount?: () => Promise<YouTubeAccountStatus>;
  refreshYouTubeSession?: () => Promise<YouTubeAccountStatus>;
  importYouTubeSession?: () => Promise<YouTubeAccountStatus>;
  disconnectYouTubeAccount?: () => Promise<YouTubeAccountStatus>;
  onYouTubeAccountConnected?: (callback: () => void) => () => void;
  onYouTubeAccountChanged?: (callback: (status: YouTubeAccountStatus) => void) => () => void;
  readExternalPlaylist: (url: string) => Promise<PlaylistReadResult>;
  readVkPlaylistInWindow: (url: string) => Promise<PlaylistReadResult>;
  cancelVkPlaylistRead: () => Promise<void>;
  // Window controls
  minimizeWindow: () => Promise<void>;
  maximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;

  // Navigation (Mouse buttons & OS shortcuts)
  onNavBack?: (callback: () => void) => () => void;
  onNavForward?: (callback: () => void) => () => void;

  // Theme animation freeze (window minimized / hidden to tray)
  onAnimationsPaused?: (callback: (paused: boolean) => void) => () => void;

  // Music API & Full Stream
  search: (
    query: string,
    limit?: number,
    source?: MusicSource,
  ) => Promise<{ data: Track[]; total: number }>;
  searchArtists?: (
    query: string,
    limit?: number,
    source?: MusicSource,
  ) => Promise<{ data: Artist[] }>;
  getCharts: (source?: MusicSource) => Promise<ChartData>;
  getGenres: () => Promise<{ data: Genre[] }>;
  getGenreTracks: (genreId: number | string, source?: MusicSource) => Promise<{ data: Track[] }>;
  getAutocomplete: (query: string) => Promise<AutocompleteSuggestion[]>;
  getArtist: (
    idOrName: string | number,
    artistName?: string,
    artistSource?: string,
  ) => Promise<ArtistDetails | null>;
  getArtistAllTracks: (
    artistIdOrName: string | number,
    artistName?: string,
    artistSource?: string,
  ) => Promise<Track[]>;
  getAlbumTracks: (
    albumId?: string | number,
    albumTitle?: string,
    artistName?: string,
  ) => Promise<Track[]>;
  getWaveBatch: (
    mood?: WaveMood,
    seedTracks?: any[],
    excludeIds?: (string | number)[],
    context?: WaveBatchContext,
    requestId?: string,
  ) => Promise<Track[]>;
  cancelWaveBatch?: (requestId: string) => Promise<void>;
  getRecommendedTracks?: (previousIds?: (string | number)[]) => Promise<Track[]>;
  getFullStreamUrl: (
    track: {
      title: string;
      artist: string | { name: string };
      id?: string | number;
      preview?: string;
      duration?: number;
      source?: 'soundcloud' | 'deezer' | 'youtube';
    },
    options?: StreamResolveOptions,
    requestId?: string,
  ) => Promise<string>;
  cancelStreamResolve?: (requestId: string) => Promise<void>;
  downloadAudioBuffer?: (
    url: string,
    requestId?: string,
  ) => Promise<Uint8Array | ArrayBuffer | null>;
  onAudioDownloadProgress?: (
    callback: (progress: { requestId: string; receivedBytes: number; totalBytes: number }) => void,
  ) => () => void;

  // Diagnostics & Playback Logger
  logPlaybackEvent?: (level: string, message: string, meta?: any) => void;
  getRecentPlaybackLogs?: (limit?: number) => Promise<string[]>;
  openLogFile?: () => Promise<{ success: boolean; filePath?: string; error?: string }>;

  // Lyrics, Chords & Songsterr Tabs API
  getLyrics: (title: string, artist: string, duration?: number) => Promise<LyricsLine[] | null>;
  getChords?: (payload: { title: string; artist: string }) => Promise<GuitarChordData | null>;
  getSongsterrTab?: (payload: {
    title: string;
    artist: string;
  }) => Promise<SongsterrTabData | null>;
  getOfficialVideoClip?: (artist: string, title: string, apiKey?: string) => Promise<string | null>;
  getVideoStream?: (
    videoId: string,
    options?: Pick<StreamResolveOptions, 'forceRefresh'>,
  ) => Promise<string>;

  // Desktop Mini-Widget
  toggleWidget: () => Promise<boolean>;
  isWidgetOpen: () => Promise<boolean>;
  onWidgetVisibilityChanged?: (callback: (open: boolean) => void) => () => void;
  sendWidgetState: (state: WidgetState) => void;
  sendWidgetCommand: (command: string, data?: any) => void;
  onWidgetCommand: (callback: (command: string, data?: any) => void) => () => void;
  onWidgetStateUpdate: (callback: (state: WidgetState) => void) => () => void;

  getLibraryPage: <K extends import('./libraryPage').LibraryKind>(
    request: import('./libraryPage').LibraryPageRequest<K>,
  ) => Promise<import('./libraryPage').LibraryPage<K>>;
  getLibraryStats: () => Promise<import('./libraryPage').LibraryStats>;
  getLibraryPlaybackTracks: (
    request: import('./libraryPage').LibraryPlaybackRequest,
  ) => Promise<LikedTrack[]>;
  getSavedAlbumIds: () => Promise<string[]>;
  getArtistMembership: () => Promise<import('./libraryPage').ArtistMembership[]>;

  // SQLite DB - Liked Tracks
  getLikedTrackIds?: () => Promise<string[]>;
  getLikedTracks: () => Promise<LikedTrack[]>;
  isTrackLiked: (deezerId: string | number) => Promise<boolean>;
  toggleLikeTrack: (track: {
    deezer_id: string | number;
    title: string;
    artist: string;
    album?: string;
    cover_url?: string;
    preview_url?: string;
    duration?: number;
    source?: 'soundcloud' | 'deezer' | 'youtube';
  }) => Promise<{ liked: boolean }>;

  // SQLite DB - Saved Albums
  getSavedAlbums: () => Promise<SavedAlbum[]>;
  isAlbumSaved: (albumId: string | number) => Promise<boolean>;
  toggleSaveAlbum: (album: {
    id: string | number;
    title: string;
    artist_name?: string;
    artist?: { id?: string | number; name: string } | string;
    cover_url?: string;
    cover?: string;
    cover_medium?: string;
    cover_big?: string;
    cover_xl?: string;
    release_date?: string;
    record_type?: string;
    track_count?: number;
  }) => Promise<{ saved: boolean }>;

  // SQLite DB - Followed Artists
  getFollowedArtists: () => Promise<FollowedArtist[]>;
  isArtistFollowed: (artistId: string | number) => Promise<boolean>;
  toggleFollowArtist: (artist: {
    id: string | number;
    name: string;
    picture_url?: string;
  }) => Promise<{ followed: boolean }>;

  // SQLite DB - Playlists
  getPlaylists: () => Promise<Playlist[]>;
  getTrackPlaylistIds: (trackId: string | number) => Promise<string[]>;
  createPlaylist: (name: string, description?: string) => Promise<Playlist>;
  setPlaylistCover: (playlistId: string, coverUrl: string) => Promise<boolean>;
  deletePlaylist: (playlistId: string) => Promise<boolean>;
  getPlaylistTracks: (playlistId: string) => Promise<PlaylistTrack[]>;
  addTrackToPlaylist: (
    playlistId: string,
    track: {
      id?: string | number;
      deezer_id: string | number;
      title: string;
      artist: string;
      album?: string;
      cover_url?: string;
      preview_url?: string;
      duration?: number;
      source?: 'soundcloud' | 'deezer' | 'youtube';
    },
  ) => Promise<boolean>;
  removeTrackFromPlaylist: (playlistId: string, trackDeezerId: string | number) => Promise<boolean>;

  // SQLite DB - Search History
  getSearchHistory: (limit?: number) => Promise<SearchHistoryItem[]>;
  addSearchHistory: (query: string) => Promise<void>;
  clearSearchHistory: () => Promise<void>;
  removeSearchHistoryItem: (id: number) => Promise<void>;

  // SQLite DB - Local Scrobbling & Dislikes
  recordScrobble?: (data: {
    track: {
      id?: string | number;
      deezer_id?: string | number;
      title: string;
      artist?: string | { name: string };
    };
    completed?: boolean;
    skipped?: boolean;
    repeated?: boolean;
  }) => Promise<void>;
  recordPlaybackSession?: (data: PlaybackSessionUpdate) => Promise<void>;
  dislikeTrack?: (track: {
    id?: string | number;
    deezer_id?: string | number;
    title: string;
    artist?: string | { name: string };
  }) => Promise<boolean>;
  undislikeTrack?: (trackId: string | number) => Promise<boolean>;
  getDislikedTrackIds?: () => Promise<string[]>;

  // SQLite DB - Listening History
  addListeningHistory?: (track: {
    track_id: string | number;
    title: string;
    artist: string;
    album?: string;
    cover_url?: string;
    source?: 'soundcloud' | 'deezer' | 'youtube';
    duration?: number;
  }) => Promise<void>;
  getListeningHistory?: (limit?: number, uniqueTracks?: boolean) => Promise<ListeningHistoryItem[]>;
  clearListeningHistory?: () => Promise<void>;

  // SQLite DB - Backup & Restore
  exportDatabase: () => Promise<DatabaseExportResult>;
  startLanSync?: () => Promise<LanSyncSession>;
  stopLanSync?: () => Promise<LanSyncSession>;
  getLanSyncStatus?: () => Promise<LanSyncSession>;
  getLanImportRequest?: () => Promise<LanImportRequest | null>;
  respondLanImport?: (id: string, accepted: boolean) => Promise<boolean>;
  onLanImportRequest?: (callback: (request: LanImportRequest | null) => void) => () => void;
  onLanSyncImported?: (callback: () => void) => () => void;
  importDatabase: (jsonText?: string) => Promise<DatabaseImportResult>;

  // Video Wallpaper (Desktop custom themes)
  selectWallpaperVideo?: () => Promise<{
    success: boolean;
    canceled?: boolean;
    filePath?: string;
    fileName?: string;
  }>;

  // Listening Stats & Smart Playlists (Desktop)
  getStats?: () => Promise<ListeningStats>;
  getSmartPlaylist?: (kind: SmartPlaylistKind) => Promise<SmartPlaylistTrack[]>;

  // Discord Rich Presence
  updateDiscordRpc: (data: {
    title: string;
    artist: string;
    album?: string;
    duration?: number;
    currentTime?: number;
    isPlaying: boolean;
    coverUrl?: string;
    trackId?: string | number;
    source?: string;
  }) => Promise<void>;
  onTrackLoudness?: (
    callback: (data: { trackId: string | number; gainDb: number }) => void,
  ) => () => void;
  onYouTubeSessionReset?: (callback: () => void) => () => void;
  onSharedListenTrack?: (callback: (track: Track) => void) => () => void;
  clearDiscordRpc: () => Promise<void>;
  toggleDiscordRpc: (enabled: boolean) => Promise<void>;

  // Zapret DPI Integration (Flowseal/zapret-discord-youtube)
  findZapretConfig?: () => Promise<ZapretCheckResult>;
  applyZapretDomains?: () => Promise<ZapretApplyResult>;
  selectZapretFile?: () => Promise<{
    canceled: boolean;
    filePath?: string;
    checkResult?: ZapretCheckResult;
  }>;
}

export interface ZapretCheckResult {
  found: boolean;
  path?: string;
  hasSoundcloud: boolean;
  hasSndcdn: boolean;
  error?: string;
}

export interface ZapretApplyResult {
  success: boolean;
  path: string;
  message: string;
}
