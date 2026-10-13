import { PlaybackIssueNotice } from '../components/PlaybackIssueNotice';
import {
  createContext,
  useContext,
  useRef,
  useCallback,
  useMemo,
  FC,
  ReactNode,
  useEffect,
  useState,
} from 'react';
import { Track } from '../types';
import { isPlayableDirectAudioUrl } from '../utils/audioUrlValidator';
import { emitToast } from './ToastContext';
import {
  AudioProgressContextType,
  AudioStateContextType,
  AudioControlsContextType,
  AudioContextType,
} from './audioTypes';
export * from './audioTypes';
export { isPlayableDirectAudioUrl };

import { readPlaybackSession } from '../services/playbackSession';
import { usePlaybackPersistence } from '../hooks/usePlaybackPersistence';
import { useQueueManager } from '../hooks/useQueueManager';
import { trackVolumeNormalization } from '../services/trackVolumeNormalization';
import { useAudioSettings } from '../hooks/useAudioSettings';
import { useWaveEngine } from '../hooks/useWaveEngine';
import { useLibraryManager } from '../hooks/useLibraryManager';
import { useSleepTimer } from '../hooks/useSleepTimer';
import { useSnippetController } from '../hooks/useSnippetController';
import { useAudioPlayerCore } from '../hooks/useAudioPlayerCore';
import { useDiscordRpc } from '../hooks/useDiscordRpc';
import { useMediaSessionIntegration } from '../hooks/useMediaSessionIntegration';
import { useDesktopWidgetSync } from '../hooks/useDesktopWidgetSync';
import { useAudioKeyboardShortcuts } from '../hooks/useAudioKeyboardShortcuts';

export const AudioStateContext = createContext<AudioStateContextType | undefined>(undefined);
export const AudioProgressContext = createContext<AudioProgressContextType | undefined>(undefined);
export const AudioControlsContext = createContext<AudioControlsContextType | undefined>(undefined);
export const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const AudioProvider: FC<{ children: ReactNode }> = ({ children }) => {
  const [initialPlayback] = useState(readPlaybackSession);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playTrackRef = useRef<
    ((track: Track, newQueue?: Track[], fromWave?: boolean) => Promise<void> | void) | null
  >(null);
  const stopSnippetRef = useRef<() => void>(() => {});
  const isSnippetPlayingRef = useRef<boolean>(false);

  // 1. Queue management
  const queueManager = useQueueManager(initialPlayback);

  // 2. Audio settings, volume, muting, fader, normalizer, scrobble flags
  const audioSettings = useAudioSettings({ audioRef });

  useEffect(
    () =>
      window.electronAPI?.onTrackLoudness?.((data) => {
        trackVolumeNormalization().remember({ id: data.trackId, source: 'youtube' }, data.gainDb);
      }),
    [],
  );

  // 3. Sleep timer
  const handleSleepTimerExpire = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused) {
      audioSettings.fadeOut(2.5, () => {
        if (audioRef.current) audioRef.current.pause();
        emitToast('Таймер сна: воспроизведение остановлено. Приятных снов! 😴', 'info', 5000);
      });
    }
  }, [audioSettings]);

  const sleepTimer = useSleepTimer({ onTimerExpire: handleSleepTimerExpire });

  // 4. Wave engine
  const waveEngine = useWaveEngine({
    queueRef: queueManager.queueRef,
    queueIndexRef: queueManager.queueIndexRef,
    setQueue: queueManager.setQueue,
    setQueueIndex: queueManager.setQueueIndex,
    playTrackRef,
  });

  // Mutable refs for library manager
  const currentTrackRef = useRef<Track | null>(null);
  const nextTrackActionRef = useRef<() => void>(() => {});
  const onNextTrack = useCallback(() => nextTrackActionRef.current(), []);

  // 5. Library manager (likes, dislikes, albums, artists, offline cache)
  const libraryManager = useLibraryManager({
    currentTrackRef,
    nextTrack: onNextTrack,
    onDislike: waveEngine.handleWaveDislike,
    onLike: waveEngine.handleWaveLike,
  });

  // 6. Core audio player (HTML5 Audio, HLS, streams, events, queue progression)
  const playerCore = useAudioPlayerCore({
    initialPlayback,
    repeatMode: queueManager.repeatMode,
    isShuffle: queueManager.isShuffle,
    sleepTimerMode: sleepTimer.sleepTimerMode,
    sleepTimerDeadline: sleepTimer.sleepTimerDeadline,
    isVolumeNormalizationEnabled: audioSettings.isVolumeNormalizationEnabled,
    queue: queueManager.queue,
    setQueue: queueManager.setQueue,
    queueIndex: queueManager.queueIndex,
    setQueueIndex: queueManager.setQueueIndex,
    queueRef: queueManager.queueRef,
    queueIndexRef: queueManager.queueIndexRef,
    repeatModeRef: queueManager.repeatModeRef,
    isShuffleRef: queueManager.isShuffleRef,
    shuffleCycleRef: queueManager.shuffleCycleRef,
    isWaveActive: waveEngine.isWaveActive,
    setIsWaveActive: waveEngine.setIsWaveActive,
    isWaveActiveRef: waveEngine.isWaveActiveRef,
    isWaveStartingRef: waveEngine.isWaveStartingRef,
    stopWave: waveEngine.stopWave,
    waveMoodRef: waveEngine.waveMoodRef,
    fetchMoreWaveTracks: waveEngine.fetchMoreWaveTracks,
    recordWavePlayback: waveEngine.recordWavePlayback,
    observeWavePlayback: waveEngine.observeWavePlayback,
    volumeRef: audioSettings.volumeRef,
    isMutedRef: audioSettings.isMutedRef,
    crossfadeDurationRef: audioSettings.crossfadeDurationRef,
    isCrossfadingRef: audioSettings.isCrossfadingRef,
    isScrobblingRef: audioSettings.isScrobblingRef,
    fadeIn: audioSettings.fadeIn,
    fadeOut: audioSettings.fadeOut,
    cancelFade: audioSettings.cancelFade,
    shouldStopOnTrackEnd: sleepTimer.shouldStopOnTrackEnd,
    sleepTimerModeRef: sleepTimer.sleepTimerModeRef,
    stopSnippetRef,
    isSnippetPlayingRef,
    refreshCachedTracks: libraryManager.refreshCachedTracks,
    audioRef,
    playTrackRef,
  });

  const getPlaybackTime = playerCore.getPlaybackPosition;
  const getPlaybackSnapshot = useCallback(() => {
    const track = playerCore.currentTrackRef.current;
    return track
      ? {
          track,
          position: playerCore.getPlaybackPosition(),
          queue: queueManager.queueRef.current,
          queueIndex: queueManager.queueIndexRef.current,
          repeatMode: queueManager.repeatModeRef.current,
          isShuffle: queueManager.isShuffleRef.current,
        }
      : null;
  }, [
    playerCore.currentTrackRef,
    playerCore.getPlaybackPosition,
    queueManager.queueRef,
    queueManager.queueIndexRef,
    queueManager.repeatModeRef,
    queueManager.isShuffleRef,
  ]);
  usePlaybackPersistence({
    audio: playerCore.audioElement,
    getSnapshot: getPlaybackSnapshot,
    track: playerCore.currentTrack,
    queue: queueManager.queue,
    queueIndex: queueManager.queueIndex,
    repeatMode: queueManager.repeatMode,
    isShuffle: queueManager.isShuffle,
  });

  useEffect(() => {
    nextTrackActionRef.current = playerCore.nextTrack;
  }, [playerCore.nextTrack]);

  // Keep library manager currentTrackRef synchronized with core player
  useEffect(() => {
    currentTrackRef.current = playerCore.currentTrack;
  }, [playerCore.currentTrack]);

  const pauseForSnippet = useCallback(
    () => playerCore.pauseMainAudio(false),
    [playerCore.pauseMainAudio],
  );

  // 7. Snippet preview controller (10-second modal and player)
  const snippetController = useSnippetController({
    volume: audioSettings.volume,
    isMuted: audioSettings.isMuted,
    onPauseMainAudio: pauseForSnippet,
    resolvedStreamCache: playerCore.resolvedStreamCache,
    loadStreamIntoAudio: playerCore.loadStreamIntoAudio,
    streamRequestIdRef: playerCore.streamRequestIdRef,
  });

  useEffect(() => {
    stopSnippetRef.current = snippetController.stopSnippet;
    isSnippetPlayingRef.current = snippetController.isSnippetPlaying;
  }, [snippetController.stopSnippet, snippetController.isSnippetPlaying]);

  // Clear queue helper (preserves current playing track)
  const clearQueue = useCallback(() => {
    queueManager.clearQueue(playerCore.currentTrackRef.current);
  }, [queueManager.clearQueue, playerCore.currentTrackRef]);

  // 8. Discord RPC synchronization
  useDiscordRpc({
    currentTrack: playerCore.currentTrack,
    isPlaying: playerCore.isPlaying,
    duration: playerCore.duration,
    currentTime: playerCore.currentTime,
    getCurrentTime: () => audioRef.current?.currentTime || playerCore.currentTime,
  });

  // 9. Media Session & Android Native Notification Integration
  useMediaSessionIntegration({
    currentTrack: playerCore.currentTrack,
    isPlaying: playerCore.isPlaying,
    isLoadingTrack: playerCore.isLoadingTrack,
    duration: playerCore.duration,
    getCurrentTime: () => audioRef.current?.currentTime || 0,
    onPlay: playerCore.resumeMainAudio,
    onPause: playerCore.pauseMainAudio,
    onNext: () => playerCore.nextTrack(),
    onPrev: () => playerCore.prevTrack(),
    onSeek: (position: number) => playerCore.seek(position),
    isTransitioningTrackRef: playerCore.isTransitioningTrackRef,
    trackTransitionTimestampRef: playerCore.trackTransitionTimestampRef,
  });

  useEffect(() => {
    if (window.location.hash === '#/widget') return;
    return window.electronAPI?.onSharedListenTrack?.((track) => {
      void playerCore.playTrack(track, [track]);
    });
  }, [playerCore.playTrack]);

  // 10. Desktop Mini-Widget Synchronization
  useDesktopWidgetSync({
    currentTrack: playerCore.currentTrack,
    currentTrackRef: playerCore.currentTrackRef,
    isPlaying: playerCore.isPlaying,
    isPlayingRef: playerCore.isPlayingRef,
    duration: playerCore.duration,
    likedTrackIds: libraryManager.likedTrackIds,
    volume: audioSettings.volume,
    audioRef,
    togglePlay: playerCore.togglePlay,
    nextTrack: playerCore.nextTrack,
    prevTrack: playerCore.prevTrack,
    seek: playerCore.seek,
    setVolume: audioSettings.setVolume,
    toggleLike: libraryManager.toggleLike,
  });

  // 11. Global Keyboard Shortcuts
  useAudioKeyboardShortcuts({
    togglePlay: playerCore.togglePlay,
    seek: playerCore.seek,
    setVolume: audioSettings.setVolume,
    volume: audioSettings.volume,
    nextTrack: playerCore.nextTrack,
    prevTrack: playerCore.prevTrack,
    audioRef,
  });

  // Context Values
  const progressValue = useMemo<AudioProgressContextType>(
    () => ({
      currentTime: playerCore.currentTime,
      duration: playerCore.duration,
      bufferedRanges: playerCore.bufferedRanges,
      snippetProgress: snippetController.snippetProgress,
    }),
    [
      playerCore.currentTime,
      playerCore.duration,
      playerCore.bufferedRanges,
      snippetController.snippetProgress,
    ],
  );

  const stateValue = useMemo<AudioStateContextType>(
    () => ({
      currentTrack: playerCore.currentTrack,
      isPlaying: playerCore.isPlaying,
      isLoadingTrack: playerCore.isLoadingTrack || waveEngine.isWaveStarting,
      volume: audioSettings.volume,
      isMuted: audioSettings.isMuted,
      repeatMode: queueManager.repeatMode,
      isShuffle: queueManager.isShuffle,
      queue: queueManager.queue,
      shuffledUpcomingIndices: queueManager.shuffledUpcomingIndices,
      queueIndex: queueManager.queueIndex,
      isWaveActive: waveEngine.isWaveActive,
      isWaveStarting: waveEngine.isWaveStarting,
      waveMood: waveEngine.waveMood,
      waveSource: waveEngine.waveSource,
      snippetTrack: snippetController.snippetTrack,
      isSnippetPlaying: snippetController.isSnippetPlaying,
      likedTrackIds: libraryManager.likedTrackIds,
      dislikedTrackIds: libraryManager.dislikedTrackIds,
      savedAlbumIds: libraryManager.savedAlbumIds,
      followedArtistIds: libraryManager.followedArtistIds,
      cachedTrackIds: libraryManager.cachedTrackIds,
      isVolumeNormalizationEnabled: audioSettings.isVolumeNormalizationEnabled,
      crossfadeDuration: audioSettings.crossfadeDuration,
      isScrobblingEnabled: audioSettings.isScrobblingEnabled,
      sleepTimerRemaining: sleepTimer.sleepTimerRemaining,
      sleepTimerMode: sleepTimer.sleepTimerMode,
    }),
    [
      playerCore.currentTrack,
      playerCore.isPlaying,
      playerCore.isLoadingTrack,
      waveEngine.isWaveStarting,
      audioSettings.volume,
      audioSettings.isMuted,
      queueManager.repeatMode,
      queueManager.isShuffle,
      queueManager.queue,
      queueManager.shuffledUpcomingIndices,
      queueManager.queueIndex,
      waveEngine.isWaveActive,
      waveEngine.waveMood,
      waveEngine.waveSource,
      snippetController.snippetTrack,
      snippetController.isSnippetPlaying,
      libraryManager.likedTrackIds,
      libraryManager.dislikedTrackIds,
      libraryManager.savedAlbumIds,
      libraryManager.followedArtistIds,
      libraryManager.cachedTrackIds,
      audioSettings.isVolumeNormalizationEnabled,
      audioSettings.crossfadeDuration,
      audioSettings.isScrobblingEnabled,
      sleepTimer.sleepTimerRemaining,
      sleepTimer.sleepTimerMode,
    ],
  );

  const controlsValue = useMemo<AudioControlsContextType>(
    () => ({
      startWave: waveEngine.startWave,
      setWaveSource: waveEngine.setWaveSource,
      stopWave: waveEngine.stopWave,
      dislikeTrack: libraryManager.dislikeTrack,
      undislikeTrack: libraryManager.undislikeTrack,
      isTrackDisliked: libraryManager.isTrackDisliked,
      refreshDislikedTracks: libraryManager.refreshDislikedTracks,
      playTrack: playerCore.playTrack,
      togglePlay: playerCore.togglePlay,
      getPlaybackTime,
      seek: playerCore.seek,
      setVolume: audioSettings.setVolume,
      toggleMute: audioSettings.toggleMute,
      nextTrack: playerCore.nextTrack,
      prevTrack: playerCore.prevTrack,
      setRepeatMode: queueManager.setRepeatMode,
      cycleRepeatMode: queueManager.cycleRepeatMode,
      toggleShuffle: queueManager.toggleShuffle,
      addToQueue: queueManager.addToQueue,
      insertIntoQueue: queueManager.insertIntoQueue,
      playNext: queueManager.playNext,
      removeFromQueue: queueManager.removeFromQueue,
      clearQueue,
      reorderQueue: queueManager.reorderQueue,
      shuffleUpcomingQueue: queueManager.shuffleUpcomingQueue,
      previewSnippet: snippetController.previewSnippet,
      toggleSnippetPlay: snippetController.toggleSnippetPlay,
      seekSnippet: snippetController.seekSnippet,
      stopSnippet: snippetController.stopSnippet,
      toggleLike: libraryManager.toggleLike,
      refreshLikedTracks: libraryManager.refreshLikedTracks,
      toggleSaveAlbum: libraryManager.toggleSaveAlbum,
      refreshSavedAlbums: libraryManager.refreshSavedAlbums,
      isAlbumSaved: libraryManager.isAlbumSaved,
      toggleVolumeNormalization: audioSettings.toggleVolumeNormalization,
      setCrossfadeDuration: audioSettings.setCrossfadeDuration,
      toggleScrobbling: audioSettings.toggleScrobbling,
      toggleFollowArtist: libraryManager.toggleFollowArtist,
      refreshFollowedArtists: libraryManager.refreshFollowedArtists,
      isArtistFollowed: libraryManager.isArtistFollowed,
      setSleepTimer: sleepTimer.setSleepTimer,
      cacheTrackForOffline: libraryManager.cacheTrackForOffline,
      removeOfflineCachedTrack: libraryManager.removeOfflineCachedTrack,
      isOfflineCached: libraryManager.isOfflineCached,
      refreshCachedTracks: libraryManager.refreshCachedTracks,
    }),
    [
      waveEngine.startWave,
      waveEngine.setWaveSource,
      waveEngine.stopWave,
      libraryManager.dislikeTrack,
      libraryManager.undislikeTrack,
      libraryManager.isTrackDisliked,
      libraryManager.refreshDislikedTracks,
      playerCore.playTrack,
      playerCore.togglePlay,
      getPlaybackTime,
      playerCore.seek,
      audioSettings.setVolume,
      audioSettings.toggleMute,
      playerCore.nextTrack,
      playerCore.prevTrack,
      queueManager.setRepeatMode,
      queueManager.cycleRepeatMode,
      queueManager.toggleShuffle,
      queueManager.addToQueue,
      queueManager.insertIntoQueue,
      queueManager.playNext,
      queueManager.removeFromQueue,
      clearQueue,
      queueManager.reorderQueue,
      queueManager.shuffleUpcomingQueue,
      snippetController.previewSnippet,
      snippetController.toggleSnippetPlay,
      snippetController.seekSnippet,
      snippetController.stopSnippet,
      libraryManager.toggleLike,
      libraryManager.refreshLikedTracks,
      libraryManager.toggleSaveAlbum,
      libraryManager.refreshSavedAlbums,
      libraryManager.isAlbumSaved,
      audioSettings.toggleVolumeNormalization,
      audioSettings.setCrossfadeDuration,
      audioSettings.toggleScrobbling,
      libraryManager.toggleFollowArtist,
      libraryManager.refreshFollowedArtists,
      libraryManager.isArtistFollowed,
      sleepTimer.setSleepTimer,
      libraryManager.cacheTrackForOffline,
      libraryManager.removeOfflineCachedTrack,
      libraryManager.isOfflineCached,
      libraryManager.refreshCachedTracks,
    ],
  );

  const fullContextValue = useMemo<AudioContextType>(
    () => ({
      ...stateValue,
      ...progressValue,
      ...controlsValue,
    }),
    [stateValue, progressValue, controlsValue],
  );

  return (
    <AudioControlsContext.Provider value={controlsValue}>
      <AudioStateContext.Provider value={stateValue}>
        <AudioProgressContext.Provider value={progressValue}>
          <AudioContext.Provider value={fullContextValue}>
            {children}
            <PlaybackIssueNotice
              issue={playerCore.playbackIssue}
              onRetry={playerCore.resumeMainAudio}
              onPause={playerCore.pauseMainAudio}
            />
          </AudioContext.Provider>
        </AudioProgressContext.Provider>
      </AudioStateContext.Provider>
    </AudioControlsContext.Provider>
  );
};

export const useAudioState = (): AudioStateContextType => {
  const context = useContext(AudioStateContext);
  if (!context) {
    throw new Error('useAudioState must be used within an AudioProvider');
  }
  return context;
};

export const useAudioProgress = (): AudioProgressContextType => {
  const context = useContext(AudioProgressContext);
  if (!context) {
    throw new Error('useAudioProgress must be used within an AudioProvider');
  }
  return context;
};

export const useAudioControls = (): AudioControlsContextType => {
  const context = useContext(AudioControlsContext);
  if (!context) {
    throw new Error('useAudioControls must be used within an AudioProvider');
  }
  return context;
};

export const useAudio = (): AudioContextType => {
  const context = useContext(AudioContext);
  if (!context) {
    throw new Error('useAudio must be used within an AudioProvider');
  }
  return context;
};
