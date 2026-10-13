import type { MusicSource, RepeatMode, Track, WaveMood } from '../types';
import type { BufferedAudioRange } from '../utils/audioBuffer';

export const SNIPPET_DURATION = 10; // 10 seconds snippet
export const DEFAULT_TRACK_DURATION = 180; // 3 minutes fallback when duration is unknown
export const STREAM_URL_MAX_AGE_MS = 7 * 60 * 1000; // 7 minutes — stream URL TTL

export interface AudioProgressContextType {
  currentTime: number;
  duration: number;
  bufferedRanges: BufferedAudioRange[];
  snippetProgress: number; // 0 to 1
}

export interface AudioStateContextType {
  // Current track & playback state (infrequent updates)
  currentTrack: Track | null;
  isPlaying: boolean;
  isLoadingTrack: boolean;
  volume: number;
  isMuted: boolean;
  repeatMode: RepeatMode;
  isShuffle: boolean;

  // Queue
  queue: Track[];
  queueIndex: number;
  shuffledUpcomingIndices: number[];

  // My Wave (Моя волна)
  isWaveActive: boolean;
  isWaveStarting: boolean;
  waveMood: WaveMood;
  waveSource: MusicSource;

  // Snippet preview (10-second clip)
  snippetTrack: Track | null;
  isSnippetPlaying: boolean;

  // Liked tracks
  likedTrackIds: Set<string>;

  // Disliked tracks (Local Smart Filter)
  dislikedTrackIds: Set<string>;

  // Saved albums
  savedAlbumIds: Set<string>;

  // Audio settings & enhancements
  isVolumeNormalizationEnabled: boolean;
  crossfadeDuration: number;
  isScrobblingEnabled: boolean;

  // Followed artists
  followedArtistIds: Set<string>;

  // Sleep Timer
  sleepTimerRemaining: number | null; // seconds remaining, or null
  sleepTimerMode: 'off' | '15' | '30' | '45' | '60' | 'end_of_track';

  // Offline Caching
  cachedTrackIds: Set<string>;
}

export interface AudioControlsContextType {
  // Wave actions
  setWaveSource: (source: MusicSource) => void;
  startWave: (mood?: WaveMood, seedTrack?: Track) => Promise<void>;
  stopWave: () => void;

  // Dislike actions
  dislikeTrack: (track: Track) => Promise<boolean>;
  undislikeTrack: (trackId: string | number) => Promise<boolean>;
  isTrackDisliked: (trackId: string | number) => boolean;
  refreshDislikedTracks: () => Promise<void>;

  // Playback actions
  playTrack: (track: Track, newQueue?: Track[], fromWave?: boolean) => void;
  togglePlay: () => void;
  getPlaybackTime: () => number;
  seek: (seconds: number) => void;
  setVolume: (vol: number) => void;
  toggleMute: () => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setRepeatMode: (mode: RepeatMode) => void;
  cycleRepeatMode: () => void;
  toggleShuffle: () => void;

  // Queue actions
  addToQueue: (track: Track) => void;
  insertIntoQueue: (track: Track, atIndex?: number) => void;
  playNext: (track: Track) => void;
  removeFromQueue: (index: number) => void;
  clearQueue: () => void;
  reorderQueue: (fromIndex: number, toIndex: number) => void;
  shuffleUpcomingQueue: () => void;

  // Snippet actions
  previewSnippet: (track: Track) => void;
  toggleSnippetPlay: () => void;
  seekSnippet: (fraction: number) => void;
  stopSnippet: () => void;

  // Liked actions
  toggleLike: (track: Track) => Promise<boolean>;
  refreshLikedTracks: () => Promise<void>;

  // Saved albums actions
  toggleSaveAlbum: (album: any) => Promise<boolean>;
  refreshSavedAlbums: () => Promise<void>;
  isAlbumSaved: (albumId: string | number) => boolean;

  // Audio settings & enhancements
  toggleVolumeNormalization: () => void;
  setCrossfadeDuration: (seconds: number) => void;
  toggleScrobbling: () => void;

  // Followed artists
  toggleFollowArtist: (artist: {
    id: string | number;
    name: string;
    picture_url?: string;
  }) => Promise<boolean>;
  refreshFollowedArtists: () => Promise<void>;
  isArtistFollowed: (artistId: string | number) => boolean;

  // Sleep Timer
  setSleepTimer: (mode: 'off' | '15' | '30' | '45' | '60' | 'end_of_track') => void;

  // Offline Caching
  cacheTrackForOffline: (track: Track) => Promise<boolean>;
  removeOfflineCachedTrack: (trackId: string | number) => Promise<boolean>;
  isOfflineCached: (trackId: string | number) => boolean;
  refreshCachedTracks: () => Promise<void>;
}

export type AudioContextType = AudioStateContextType &
  AudioProgressContextType &
  AudioControlsContextType;
