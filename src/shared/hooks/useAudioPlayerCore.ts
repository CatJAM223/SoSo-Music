import { recoverPlayerStream, resolvePlayerStream } from '../services/playerStreamResolution';
import { prefetchQueueIndices } from '../utils/playbackQueueOrder';
import { invalidatePlaybackIntent } from '../utils/playbackIntent.ts';
import { selectPlayerQueue } from '../utils/playerQueueSelection';
import type { PlaybackOrigin } from '../types/tastePolicy';
import { normalizePlaybackOrigin, withPlaybackOrigin } from '../utils/tastePolicy';
import { queueEntryKey } from '../utils/queueEntry';
import { AudioProgressWatchdog } from '../utils/audioProgressWatchdog';
import { readCachedPlayerCover, readCachedPlayerSource } from '../services/playerCachedSource';
import type { WavePlaybackReason } from '../utils/waveFeedback';
import { BoundedMap, BoundedSet } from '../utils/boundedCache';
import { getStreamResolveFailure, type StreamResolveFailure } from '../utils/streamResolveError';
import { usePlaybackTaskScope } from './usePlaybackTaskScope';
import { useYouTubeAvailability } from './useYouTubeAvailability';
import {
  availableQueueIndex,
  isYouTubeItemDisabled,
  isYouTubePlaybackDisabled,
} from '../services/youtubeAvailability';
import { isCachedAudioDecodeError } from '../utils/cachedAudioFailure';
import { StreamResolveTimeoutError } from '../utils/streamResolveDeadline';
import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { HlsRecoveryBudget } from '../utils/hlsRecovery';
import { watchAudioStartup, type AudioLoadOwner } from '../utils/audioStartup';
import { AudioCrossfade } from '../services/audioCrossfade';
import {
  createPlayerAudio,
  preparePlayerAudio,
  releasePlayerAudio,
} from '../services/createPlayerAudio';

import { RepeatMode, Track, WaveMood, type StreamResolveOptions } from '../types';
import { detectTrackSource, resolveTrackCover } from '../utils/formatters';
import { emitYouTubeAccessIssue } from '../utils/youtubeAccessHint';
import {
  getYouTubeAudioAccessError,
  youtubeAudioAccessMessage,
} from '../utils/youtubeAudioAccessError';
import { platformBridge } from '../bridge/platformBridge';
import { audioCacheService, AudioCacheService } from '../services/audioCacheService';
import { offlineCacheService } from '../services/offlineCacheService';

import { emitToast } from '../context/ToastContext';
import { logger } from '../utils/logger';
import { PlaybackLogger } from '../services/playbackLogger';
import { isPlayableDirectAudioUrl, isYouTubeAudioStreamUrl } from '../utils/audioUrlValidator';
import { shouldTriggerNearEndFade } from '../utils/crossfade';
import {
  isCurrentPlaybackRequest,
  shouldHaltPlaybackOnConsecutiveErrors,
  shouldRecordListeningStart,
} from '../utils/playbackRecovery';
import { DEFAULT_TRACK_DURATION, STREAM_URL_MAX_AGE_MS } from '../context/audioTypes';
import { applyAudioVolume } from '../utils/audioVolume';
import {
  hasAudioBufferHeadroom,
  readAudioBufferedRanges,
  sameBufferedRanges,
  type BufferedAudioRange,
  type BufferedAudioSource,
} from '../utils/audioBuffer';
import { playedMediaDelta } from '../utils/listeningTime';
import { ShuffleCycle } from '../utils/shuffleCycle';
import type { PlaybackSession } from '../services/playbackSession';
import type { SleepTimerMode } from './useSleepTimer';

function getSafeAudioSourceLabel(source: string): string {
  if (!source) return '<empty>';
  if (source.startsWith('blob:')) return 'blob:<redacted>';

  try {
    const url = new URL(source);
    const path = url.hostname.endsWith('googlevideo.com') ? '/videoplayback' : url.pathname;
    const itag = url.searchParams.get('itag');
    return `${url.origin}${path}${itag ? ` (itag=${itag})` : ''}`;
  } catch {
    return '<non-http audio source>';
  }
}

function getAudioItag(source: string): number | undefined {
  try {
    const url = new URL(source);
    const rawItag = url.searchParams.get('itag') || url.pathname.match(/\/itag\/(\d+)/)?.[1];
    const itag = Number(rawItag);
    return Number.isInteger(itag) && itag > 0 ? itag : undefined;
  } catch {
    return undefined;
  }
}

function isPlayableStreamForTrack(url: string | null | undefined, track: Track): boolean {
  if (!isPlayableDirectAudioUrl(url)) return false;
  const isYouTubeStream = isYouTubeAudioStreamUrl(url);
  const source = detectTrackSource(track);
  if (source === 'youtube') return isYouTubeStream;
  if (source === 'soundcloud') return !isYouTubeStream;
  return true;
}

interface UseAudioPlayerCoreProps {
  initialPlayback?: PlaybackSession | null;
  repeatMode?: RepeatMode;
  isShuffle?: boolean;
  sleepTimerMode?: SleepTimerMode;
  sleepTimerDeadline?: number | null;
  isVolumeNormalizationEnabled?: boolean;
  queue: Track[];
  setQueue: React.Dispatch<React.SetStateAction<Track[]>>;
  queueIndex: number;
  setQueueIndex: React.Dispatch<React.SetStateAction<number>>;
  queueRef: React.MutableRefObject<Track[]>;
  queueIndexRef: React.MutableRefObject<number>;
  repeatModeRef: React.MutableRefObject<RepeatMode>;
  isShuffleRef: React.MutableRefObject<boolean>;
  shuffleCycleRef: React.MutableRefObject<ShuffleCycle>;
  isWaveActive: boolean;
  setIsWaveActive: React.Dispatch<React.SetStateAction<boolean>>;
  isWaveActiveRef: React.MutableRefObject<boolean>;
  isWaveStartingRef: React.MutableRefObject<boolean>;
  stopWave: () => void;
  waveMoodRef: React.MutableRefObject<WaveMood>;
  fetchMoreWaveTracks: () => Promise<void>;
  recordWavePlayback: (
    track: Track,
    playedSeconds: number,
    durationSeconds: number,
    reason?: WavePlaybackReason,
  ) => void;
  observeWavePlayback: (track: Track, playedSeconds: number) => void;
  volumeRef: React.MutableRefObject<number>;
  isMutedRef: React.MutableRefObject<boolean>;
  crossfadeDurationRef: React.MutableRefObject<number>;
  isCrossfadingRef: React.MutableRefObject<boolean>;
  isScrobblingRef: React.MutableRefObject<boolean>;
  fadeIn: (durationSeconds: number) => void;
  fadeOut: (durationSeconds: number, onComplete?: () => void) => void;
  cancelFade: () => void;
  shouldStopOnTrackEnd: () => boolean;
  sleepTimerModeRef: React.MutableRefObject<SleepTimerMode>;
  stopSnippetRef: React.MutableRefObject<() => void>;
  isSnippetPlayingRef: React.MutableRefObject<boolean>;
  refreshCachedTracks: () => Promise<void>;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  playTrackRef: React.MutableRefObject<
    ((track: Track, newQueue?: Track[], fromWave?: boolean) => Promise<void> | void) | null
  >;
  setIsLoadingTrackProp?: (loading: boolean) => void;
}

export function useAudioPlayerCore({
  initialPlayback = null,

  setQueue,
  setQueueIndex,
  queueRef,
  queueIndexRef,
  repeatModeRef,
  isShuffleRef,
  shuffleCycleRef,
  setIsWaveActive,
  isWaveActiveRef,
  isWaveStartingRef,
  stopWave,
  fetchMoreWaveTracks,
  recordWavePlayback,
  observeWavePlayback,
  volumeRef,
  isMutedRef,
  crossfadeDurationRef,
  isCrossfadingRef,
  isScrobblingRef,
  fadeIn,
  fadeOut,
  cancelFade,
  shouldStopOnTrackEnd,
  sleepTimerModeRef,
  stopSnippetRef,
  isSnippetPlayingRef,
  refreshCachedTracks,
  audioRef,
  playTrackRef,
}: UseAudioPlayerCoreProps) {
  // Keep recent backwards navigation without retaining every played wave item.
  // Explicit playlists and their repeat/shuffle cycles keep their full queue.
  const compactWaveQueue = useCallback(
    (index: number): number => {
      if (
        !isWaveActiveRef.current ||
        isWaveStartingRef.current ||
        index < 60 ||
        index >= queueRef.current.length
      )
        return index;
      const removed = index - 30;
      const next = queueRef.current.slice(removed);
      queueRef.current = next;
      queueIndexRef.current = 30;
      setQueue(next);
      setQueueIndex(30);
      return 30;
    },
    [isWaveActiveRef, isWaveStartingRef, queueRef, queueIndexRef, setQueue, setQueueIndex],
  );

  const mainHlsRef = useRef<Hls | null>(null);
  const pendingSeekCleanupRef = useRef(new Map<HTMLAudioElement, () => void>());
  const crossfadeRef = useRef(new AudioCrossfade());
  const automaticCrossfadeRef = useRef(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  useEffect(() => () => crossfadeRef.current.stop(), []);
  const currentTrackRef = useRef<Track | null>(initialPlayback?.track ?? null);
  const pendingPositionRef = useRef<number | null>(initialPlayback?.position ?? null);
  const lastPositionRef = useRef(initialPlayback?.position ?? 0);
  const getPlaybackPosition = useCallback(
    () =>
      pendingPositionRef.current ??
      (audioRef.current?.getAttribute('src')
        ? audioRef.current.currentTime
        : lastPositionRef.current),
    [audioRef],
  );
  const streamRequestIdRef = useRef<number>(0);
  const streamLoadIdRef = useRef<number>(0);
  const {
    cancelScheduledRecovery,
    invalidatePlayback,
    schedulePlaybackRecovery,
    playbackAbortRef,
  } = usePlaybackTaskScope(streamRequestIdRef, streamLoadIdRef);
  const playIntentRef = useRef(0);
  const [playbackIssue, setPlaybackIssue] = useState<{
    kind: StreamResolveFailure;
    autoResume: boolean;
  } | null>(null);
  const temporaryRecoveryRef = useRef<{
    requestId: number;
    trackId: string;
    intent: number;
    position: number;
  } | null>(null);
  const temporaryRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temporaryRetryAttemptRef = useRef(0);
  const retryingTemporaryFailureRef = useRef(false);
  const retryTemporaryRef = useRef<() => void>(() => {});
  const cancelTemporaryRetry = useCallback(() => {
    if (temporaryRetryTimerRef.current !== null) clearTimeout(temporaryRetryTimerRef.current);
    temporaryRetryTimerRef.current = null;
  }, []);
  useEffect(() => () => cancelTemporaryRetry(), [cancelTemporaryRetry]);
  useEffect(() => {
    const online = () => retryTemporaryRef.current();
    window.addEventListener('online', online);
    return () => window.removeEventListener('online', online);
  }, []);
  const pendingResolutionRef = useRef(false);
  const resumeNeedsResolveRef = useRef(false);
  const trackClickTimestampRef = useRef<number>(0);
  const lastLoggedPlaybackRequestRef = useRef<number | null>(null);
  const bufferingStartedAtRef = useRef(0);
  const streamRetryCountRef = useRef<number>(0);
  const rejectedStreamTracksRef = useRef<Set<string>>(new BoundedSet(128));
  const handledMediaErrorRef = useRef<{
    requestId: number;
    source: string;
    code: number | null;
    handledAt: number;
  } | null>(null);
  const stalledRecoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const progressWatchdogRef = useRef(new AudioProgressWatchdog());
  const resetProgressWatchRef = useRef<() => void>(() => {});
  const consecutivePlaybackErrorsRef = useRef<number>(0);

  // Cache for resolved stream URLs — avoids mutating Track objects in React state
  const resolvedStreamCache = useRef<Map<string, { url: string; timestamp: number }>>(
    new BoundedMap(128, (entry) => entry.timestamp + STREAM_URL_MAX_AGE_MS),
  );

  useEffect(
    () =>
      window.electronAPI?.onYouTubeSessionReset?.(() => {
        for (const [id, entry] of resolvedStreamCache.current) {
          if (id.startsWith('yt_') || isYouTubeAudioStreamUrl(entry.url))
            resolvedStreamCache.current.delete(id);
        }
      }),
    [],
  );

  // Mutable refs to eliminate stale closures in audio event listeners
  const nextTrackRef = useRef<() => void>(() => {});
  const prevTrackRef = useRef<() => void>(() => {});
  const handleErrorRef = useRef<
    (failedLoad?: true, resumePosition?: number, temporaryFailure?: StreamResolveFailure) => void
  >(() => {});
  const handleUnavailableStreamRef = useRef<(track: Track, requestId: number) => void>(() => {});
  const isTransitioningTrackRef = useRef<boolean>(false);
  const trackTransitionTimestampRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const playbackSessionRef = useRef<{
    id: string;
    track: Track;
    origin?: PlaybackOrigin;
    playedSeconds: number;
    savedSeconds: number;
    lastPosition: number;
    lastWallTime: number;
    finalized: boolean;
  } | null>(null);
  const lastHistoryRequestIdRef = useRef<number>(-1);
  const prefetchTriggeredForTrackRef = useRef<string | number | null>(null);
  const lookaheadTriggeredForTrackRef = useRef<string | number | null>(null);

  const prefetchLookaheadTargetRef = useRef<string | null>(null);
  const prefetchPlanRef = useRef<{
    queue: Track[];
    index: number;
    currentId: Track['id'] | undefined;
    shuffle: boolean;
    wrap: boolean;
    youtubeDisabled: boolean;
    indices: number[];
  } | null>(null);

  const youtubeDisabled = useYouTubeAvailability();

  // States
  const [currentTrack, setCurrentTrack] = useState<Track | null>(initialPlayback?.track ?? null);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isLoadingTrack, setIsLoadingTrack] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(initialPlayback?.position ?? 0);
  const [duration, setDuration] = useState<number>(
    initialPlayback?.track.duration || DEFAULT_TRACK_DURATION,
  );
  const [bufferedRanges, setBufferedRanges] = useState<BufferedAudioRange[]>([]);
  const bufferedSourceRef = useRef<BufferedAudioSource | null>(null);
  const resetBufferedRanges = useCallback(() => {
    bufferedSourceRef.current = null;
    setBufferedRanges((prev) => (prev.length ? [] : prev));
  }, []);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    currentTrackRef.current = currentTrack;
    prefetchTriggeredForTrackRef.current = null;
    lookaheadTriggeredForTrackRef.current = null;
    prefetchLookaheadTargetRef.current = null;
    prefetchPlanRef.current = null;
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('soso:active-track', { detail: currentTrack }));
    }
  }, [currentTrack]);

  const startPlaybackSession = useCallback((track: Track, position = 0) => {
    playbackSessionRef.current = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      track,
      origin: normalizePlaybackOrigin(track.queueOrigin),
      playedSeconds: 0,
      savedSeconds: 0,
      lastPosition: position,
      lastWallTime: performance.now(),
      finalized: false,
    };
  }, []);

  const samplePlayback = useCallback(
    (audio: HTMLAudioElement, allowPaused = false) => {
      const session = playbackSessionRef.current;
      if (!session || session.finalized) return;
      const now = performance.now();
      const position = audio.currentTime;
      const elapsed = Math.max(0, (now - session.lastWallTime) / 1000);
      session.playedSeconds += playedMediaDelta(
        session.lastPosition,
        position,
        elapsed,
        audio.playbackRate,
        allowPaused || !audio.paused,
        audio.seeking,
      );

      session.lastPosition = position;
      session.lastWallTime = now;
      observeWavePlayback(session.track, session.playedSeconds);
    },
    [observeWavePlayback],
  );

  const savePlaybackSession = useCallback(
    (force = false, completed = false, skipped = false, repeated = false) => {
      const session = playbackSessionRef.current;
      if (!session || !isScrobblingRef.current || session.playedSeconds < 0.5) return;
      if (!force && session.playedSeconds - session.savedSeconds < 15) return;
      session.savedSeconds = session.playedSeconds;
      platformBridge
        .recordPlaybackSession({
          sessionId: session.id,
          origin: session.origin,
          track: session.track,
          playedSeconds: session.playedSeconds,
          completed,
          skipped,
          repeated,
        })
        .then(() => {
          if (typeof window !== 'undefined') window.dispatchEvent(new Event('soso:stats-updated'));
        })
        .catch(() => {
          PlaybackLogger.warn('[AudioPlayer:Statistics] Listening checkpoint could not be saved', {
            sessionId: session.id,
            trackId: session.track.id,
            playedSeconds: session.playedSeconds,
          });
        });
    },
    [isScrobblingRef],
  );

  const finishPlaybackSession = useCallback(
    (audio: HTMLAudioElement, repeated = false, reachedEnd = false) => {
      const session = playbackSessionRef.current;
      if (!session || session.finalized) return;
      samplePlayback(audio, true);
      const duration =
        Number.isFinite(audio.duration) && audio.duration > 0
          ? audio.duration
          : session.track.duration;
      const nearEnd =
        reachedEnd ||
        (Number.isFinite(audio.duration) &&
          audio.duration - audio.currentTime <= Math.max(2, crossfadeDurationRef.current + 1));
      const completed = nearEnd && duration > 0 && session.playedSeconds >= duration * 0.8;
      const playbackFailed = handledMediaErrorRef.current?.requestId === streamRequestIdRef.current;
      savePlaybackSession(true, completed, !completed && !playbackFailed, repeated);
      // Ended and crossfade transitions also feed the wave; nextTrack deduplicates this observation.
      if (
        nearEnd &&
        isWaveActiveRef.current &&
        !isWaveStartingRef.current &&
        handledMediaErrorRef.current?.requestId !== streamRequestIdRef.current
      ) {
        recordWavePlayback(session.track, session.playedSeconds, duration, 'ended');
      }
      session.finalized = true;
    },
    [
      crossfadeDurationRef,
      isWaveActiveRef,
      isWaveStartingRef,
      recordWavePlayback,
      samplePlayback,
      savePlaybackSession,
    ],
  );

  // A network failure is not a dislike or an unavailable recording. Keep the queue and position.
  const holdTemporaryFailure = useCallback(
    (kind: StreamResolveFailure, track: Track, position?: number) => {
      cancelTemporaryRetry();
      cancelFade();
      crossfadeRef.current.stop();
      isCrossfadingRef.current = false;
      const audio = audioRef.current;
      const resumeAt = Math.max(0, position ?? getPlaybackPosition());
      if (audio) {
        samplePlayback(audio, true);
        savePlaybackSession(true);
      }
      resolvedStreamCache.current.delete(String(track.id));
      rejectedStreamTracksRef.current.add(String(track.id));
      invalidatePlayback();
      const requestId = streamRequestIdRef.current;
      temporaryRecoveryRef.current = {
        requestId,
        trackId: String(track.id),
        intent: playIntentRef.current,
        position: resumeAt,
      };
      handledMediaErrorRef.current = {
        requestId,
        source: audio?.src || '',
        code: 2,
        handledAt: Date.now(),
      };
      pendingPositionRef.current = resumeAt;
      lastPositionRef.current = resumeAt;
      pendingResolutionRef.current = false;
      resumeNeedsResolveRef.current = true;
      isTransitioningTrackRef.current = false;
      trackTransitionTimestampRef.current = 0;
      if (stalledRecoveryTimerRef.current !== null) clearTimeout(stalledRecoveryTimerRef.current);
      stalledRecoveryTimerRef.current = null;
      mainHlsRef.current?.destroy();
      mainHlsRef.current = null;
      if (audio) {
        pendingSeekCleanupRef.current.get(audio)?.();
        audio.pause();
        {
          audio.removeAttribute('src');
          audio.load();
        }
      }
      isPlayingRef.current = false;
      setIsPlaying(false);
      setIsLoadingTrack(false);
      setCurrentTime(resumeAt);
      setPlaybackIssue({ kind, autoResume: temporaryRetryAttemptRef.current < 2 });
      audioCacheService.setPlaybackBuffering(true);
      PlaybackLogger.warn('[Playback:Recovery] Waiting for source/network', {
        trackId: track.id,
        reason: kind,
        position: Math.round(resumeAt),
        attempt: temporaryRetryAttemptRef.current,
      });
      // Two retries per user action; an offline device waits for the online event without polling.
      if (navigator.onLine !== false && temporaryRetryAttemptRef.current < 2) {
        const delay =
          kind === 'rate-limit'
            ? [10000, 30000][temporaryRetryAttemptRef.current]
            : [2000, 5000][temporaryRetryAttemptRef.current];
        temporaryRetryTimerRef.current = setTimeout(() => {
          temporaryRetryTimerRef.current = null;
          retryTemporaryRef.current();
        }, delay);
      }
    },
    [
      audioRef,
      cancelFade,
      cancelTemporaryRetry,
      getPlaybackPosition,
      invalidatePlayback,
      isCrossfadingRef,
      samplePlayback,
      savePlaybackSession,
    ],
  );

  // Load stream into audio with HLS / Progressive fallback and full local cache
  const loadStreamIntoAudio = useCallback(
    (
      audio: HTMLAudioElement,
      hlsRef: React.MutableRefObject<Hls | null>,
      streamUrl: string,
      startSeekSeconds?: number,
      isSnippet: boolean = false,
      trackId?: string | number,
      bypassMemoryBlob: boolean = false,
      loadOwner?: AudioLoadOwner,
    ) => {
      pendingSeekCleanupRef.current.get(audio)?.();
      if (!isSnippet) {
        pendingResolutionRef.current = false;
        resetBufferedRanges();
      }
      const loadId = isSnippet ? null : ++streamLoadIdRef.current;
      const isStaleLoad = () =>
        (loadId !== null && loadId !== streamLoadIdRef.current) ||
        !!loadOwner?.signal.aborted ||
        (loadOwner !== undefined && !loadOwner.isCurrent());
      if (isStaleLoad()) return;
      const handlePlaybackStarted = (crossfadeSeconds: number) => {
        if (isStaleLoad()) return;
        if (isSnippet) {
          audio.volume = isMutedRef.current ? 0 : volumeRef.current;
        } else {
          setIsPlaying(true);
          setIsLoadingTrack(false);
          isCrossfadingRef.current = false;
          if (crossfadeSeconds > 0) {
            isCrossfadingRef.current = true;
            if (
              !crossfadeRef.current.start(
                audio,
                crossfadeSeconds,
                () => (isMutedRef.current ? 0 : volumeRef.current),
                () => {
                  isCrossfadingRef.current = false;
                },
              )
            ) {
              isCrossfadingRef.current = false;
              fadeIn(Math.min(crossfadeSeconds, 2.5));
            }
          } else {
            audio.volume = isMutedRef.current ? 0 : volumeRef.current;
          }
        }
      };
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }

      if (!streamUrl || !streamUrl.trim() || !isPlayableDirectAudioUrl(streamUrl)) {
        if (streamUrl && streamUrl.trim()) {
          PlaybackLogger.warn(
            `[AudioContext] Refused to load non-audio URL into HTML5 audio: ${getSafeAudioSourceLabel(streamUrl)}`,
          );
          console.warn(
            '[AudioContext] Refused to load non-audio URL:',
            getSafeAudioSourceLabel(streamUrl),
          );
        }
        if (isSnippet) loadOwner?.onFailure();
        else handleErrorRef.current?.();
        return;
      }

      // Cleanly pause existing playback before swapping sources to avoid demuxer abort/format errors
      try {
        audio.pause();
      } catch (e) {}

      const isHls = AudioCacheService.isHlsUrl(streamUrl);
      PlaybackLogger.info(
        `[AudioPlayer:Load] Loading ${isHls ? 'HLS' : 'Progressive'} audio stream (id: ${trackId || 'unknown'})...`,
      );

      if (isHls && Hls.isSupported()) {
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: false,
          maxBufferLength: 45,
          maxMaxBufferLength: 90,
          maxBufferSize: 16 * 1024 * 1024,
          backBufferLength: 15,
          startPosition:
            typeof startSeekSeconds === 'number' && startSeekSeconds > 0 ? startSeekSeconds : -1,
        });
        hlsRef.current = hls;
        hls.on(Hls.Events.MEDIA_ATTACHED, () => {
          if (!isSnippet && !isStaleLoad()) bufferedSourceRef.current = { audio, url: audio.src };
        });
        hls.attachMedia(audio);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (isStaleLoad()) return;
          if (typeof startSeekSeconds === 'number' && startSeekSeconds > 0) {
            try {
              audio.currentTime = Math.min(
                startSeekSeconds,
                Number.isFinite(audio.duration) && audio.duration > 0
                  ? audio.duration
                  : startSeekSeconds,
              );
              if (!isSnippet) pendingPositionRef.current = null;
            } catch (e) {
              logger.debug('[AudioContext] HLS initial seek notice:', e);
            }
          }
          const crossfadeSeconds = crossfadeDurationRef.current;
          if (!isSnippet && crossfadeSeconds > 0 && !isMutedRef.current && volumeRef.current > 0) {
            audio.volume = 0;
          } else {
            audio.volume = isMutedRef.current ? 0 : volumeRef.current;
          }
          audio
            .play()
            .then(() => handlePlaybackStarted(crossfadeSeconds))
            .catch((e) => {
              if (isStaleLoad()) return;
              isTransitioningTrackRef.current = false;
              console.warn('HLS play error:', e);
              if (isSnippet && e?.name !== 'AbortError') loadOwner?.onFailure();
              if (!isSnippet) {
                setIsLoadingTrack(false);
                if (e?.name !== 'AbortError') {
                  handleErrorRef.current?.();
                }
              }
            });
        });

        const recoveryBudget = new HlsRecoveryBudget();
        let recoveryFailed = false;
        const failHls = (failure?: StreamResolveFailure) => {
          if (recoveryFailed || isStaleLoad()) return;
          recoveryFailed = true;
          const resumePosition = audio.currentTime;
          try {
            hls.destroy();
          } catch {
            PlaybackLogger.warn('[AudioPlayer:HLS] Cleanup failed; continuing source recovery');
          } finally {
            if (hlsRef.current === hls) hlsRef.current = null;
            if (isSnippet) {
              audio.pause();
              loadOwner?.onFailure(failure);
            } else handleErrorRef.current?.(true, resumePosition, failure);
          }
        };
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (recoveryFailed || isStaleLoad()) return;
          PlaybackLogger.warn('[AudioPlayer:HLS] Source loading error', {
            trackId,
            type: data.type,
            details: data.details,
            fatal: data.fatal,
            status: data.response?.code,
            readyState: audio.readyState,
          });
          if (!data.fatal) return;
          const kind =
            data.type === Hls.ErrorTypes.NETWORK_ERROR
              ? 'network'
              : data.type === Hls.ErrorTypes.MEDIA_ERROR
                ? 'media'
                : 'other';
          // startLoad() cannot repair a rejected/expired master manifest.
          if (
            kind === 'network' &&
            (data.details === 'manifestLoadError' ||
              data.details === 'manifestLoadTimeOut' ||
              data.response?.code === 401 ||
              data.response?.code === 403 ||
              data.response?.code === 429)
          ) {
            failHls(data.response?.code === 429 ? 'rate-limit' : 'network');
            return;
          }
          const action = recoveryBudget.next(kind);
          try {
            if (action === 'reload') hls.startLoad();
            else if (action === 'recover') hls.recoverMediaError();
            else failHls(kind === 'network' ? 'network' : undefined);
          } catch {
            PlaybackLogger.warn('[AudioPlayer:HLS] Recovery failed; refreshing the stream');
            failHls(kind === 'network' ? 'network' : undefined);
          }
        });
        const stopStartupWatch = watchAudioStartup(
          audio,
          () => !recoveryFailed && !isStaleLoad() && hlsRef.current === hls,
          () => {
            PlaybackLogger.warn('[AudioPlayer:HLS] No playback start after 8s; refreshing source', {
              trackId,
              readyState: audio.readyState,
            });
            failHls('timeout');
          },
          loadOwner?.signal ?? (isSnippet ? undefined : playbackAbortRef.current.signal),
        );
        hls.on(Hls.Events.DESTROYING, stopStartupWatch);
        hls.loadSource(streamUrl);
      } else {
        // Use local cached Blob if available for 100% offline background resilience
        const cachedBlob =
          trackId && !bypassMemoryBlob ? audioCacheService.getCachedBlobUrl(trackId) : null;
        const effectivePlayUrl = cachedBlob || streamUrl;

        audio.src = effectivePlayUrl;

        if (!isSnippet) bufferedSourceRef.current = { audio, url: audio.src };
        if (!isSnippet)
          audioCacheService.setPinnedUrl(
            effectivePlayUrl.startsWith('blob:') ? effectivePlayUrl : null,
          );
        const crossfadeSeconds = crossfadeDurationRef.current;
        if (!isSnippet && crossfadeSeconds > 0 && !isMutedRef.current && volumeRef.current > 0) {
          audio.volume = 0;
        } else {
          audio.volume = isMutedRef.current ? 0 : volumeRef.current;
        }
        if (typeof startSeekSeconds === 'number' && startSeekSeconds > 0) {
          const seekTarget = startSeekSeconds;
          const clearSeek = () => {
            audio.removeEventListener('loadedmetadata', handleMetadata);
            audio.removeEventListener('canplay', handleMetadata);
            if (pendingSeekCleanupRef.current.get(audio) === clearSeek)
              pendingSeekCleanupRef.current.delete(audio);
          };
          const handleMetadata = () => {
            if (isStaleLoad()) {
              clearSeek();
              return;
            }
            try {
              audio.currentTime = Math.min(
                seekTarget,
                Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : seekTarget,
              );
              if (!isSnippet) pendingPositionRef.current = null;
              clearSeek();
            } catch {
              /* The canplay event retries when metadata alone is insufficient. */
            }
          };
          if (audio.readyState >= 1) handleMetadata();
          else {
            audio.addEventListener('loadedmetadata', handleMetadata);
            audio.addEventListener('canplay', handleMetadata);
            pendingSeekCleanupRef.current.set(audio, clearSeek);
          }
        }

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => handlePlaybackStarted(crossfadeSeconds))
            .catch((e) => {
              if (isStaleLoad()) return;
              isTransitioningTrackRef.current = false;
              console.warn('Audio play notice:', e);
              if (isSnippet && e?.name !== 'AbortError') loadOwner?.onFailure();
              if (!isSnippet) {
                setIsLoadingTrack(false);
                if (e?.name !== 'AbortError') {
                  handleErrorRef.current?.();
                }
              }
            });
        }

        // Bulk caching starts after stable playback, so it cannot starve the audible stream.
      }
    },
    [fadeIn, crossfadeDurationRef, isCrossfadingRef, isMutedRef, volumeRef, resetBufferedRanges],
  );

  const prefetchTrackStream = useCallback(
    (targetTrack?: Track) => {
      if (!targetTrack || !targetTrack.id || isYouTubeItemDisabled(targetTrack)) return;
      const audio = audioRef.current;
      if (pendingResolutionRef.current || !audio || audio.paused || audio.readyState < 3) return;
      const cached = resolvedStreamCache.current.get(String(targetTrack.id));
      const isStreamFresh = cached && Date.now() - cached.timestamp < STREAM_URL_MAX_AGE_MS;
      const cachedUrl =
        isStreamFresh && cached && isPlayableStreamForTrack(cached.url, targetTrack)
          ? cached.url
          : undefined;
      audioCacheService.prefetchTrack(targetTrack, cachedUrl);
    },
    [audioRef],
  );

  const prefetchUpcomingTrack = useCallback(
    (lookahead = false) => {
      if (repeatModeRef.current === 'one' || sleepTimerModeRef.current === 'end_of_track') return;
      const q = queueRef.current;
      const youtubeDisabled = isYouTubePlaybackDisabled();
      const index = queueIndexRef.current;
      const currentId = queueEntryKey(currentTrackRef.current ?? undefined);
      const shuffle = isShuffleRef.current && !isWaveActiveRef.current;
      const wrap = repeatModeRef.current === 'all' && !isWaveActiveRef.current;
      let plan = prefetchPlanRef.current;
      // Reuse the two targets across timeupdate events; queue edits publish a new array.
      if (
        !plan ||
        plan.queue !== q ||
        plan.index !== index ||
        plan.currentId !== currentId ||
        plan.shuffle !== shuffle ||
        plan.wrap !== wrap ||
        plan.youtubeDisabled !== youtubeDisabled
      ) {
        const order = shuffle ? shuffleCycleRef.current.upcoming(q, currentId, wrap) : undefined;
        plan = {
          queue: q,
          index,
          currentId,
          shuffle,
          wrap,
          youtubeDisabled,
          indices: prefetchQueueIndices(
            q.length,
            index,
            order,
            wrap,
            (candidate) => !isYouTubeItemDisabled(q[candidate], youtubeDisabled),
          ),
        };
        prefetchPlanRef.current = plan;
      }
      const target = q[plan.indices[lookahead ? 1 : 0]];
      if (!target) return;
      const key = JSON.stringify([streamRequestIdRef.current, target.id]);
      const triggered = lookahead ? prefetchLookaheadTargetRef : prefetchTriggeredForTrackRef;
      if (triggered.current === key) return;
      triggered.current = key;
      prefetchTrackStream(target);
    },
    [
      queueRef,
      queueIndexRef,
      repeatModeRef,
      sleepTimerModeRef,
      isShuffleRef,
      isWaveActiveRef,
      shuffleCycleRef,
      prefetchTrackStream,
    ],
  );

  // Initialize main audio element once
  useEffect(() => {
    const audio = createPlayerAudio();
    audio.preload = 'auto';
    audio.autoplay = false;
    audioRef.current = audio;
    setAudioElement(audio);
    return () => {
      lastPositionRef.current = getPlaybackPosition();
      for (const clearSeek of pendingSeekCleanupRef.current.values()) clearSeek();
      audioCacheService.clear();
      audioRef.current?.pause();
      if (audioRef.current) releasePlayerAudio(audioRef.current);
      crossfadeRef.current.stop();
      offlineCacheService.releaseUnusedTrackUrls([]);
    };
  }, [audioRef, getPlaybackPosition]);

  useEffect(() => {
    const audio = audioElement;
    if (!audio) return;

    applyAudioVolume(audio, volumeRef.current, isMutedRef.current);

    const clearStalledRecoveryTimer = () => {
      if (stalledRecoveryTimerRef.current !== null) {
        clearTimeout(stalledRecoveryTimerRef.current);
        stalledRecoveryTimerRef.current = null;
      }
    };

    let progressTimer: ReturnType<typeof setTimeout> | null = null;
    let progressNudge: { requestId: number; source: string; target: number } | null = null;
    let assigningProgressNudge = false;
    const ownsProgressNudge = () => {
      if (
        progressNudge &&
        progressNudge.requestId === streamRequestIdRef.current &&
        progressNudge.source === (audio.currentSrc || audio.src) &&
        (assigningProgressNudge || Math.abs(audio.currentTime - progressNudge.target) <= 0.01)
      )
        return true;
      progressNudge = null;
      return false;
    };
    const clearProgressWatch = () => {
      if (progressTimer !== null) clearTimeout(progressTimer);
      progressTimer = null;
      progressNudge = null;
      progressWatchdogRef.current.suspend();
    };
    resetProgressWatchRef.current = clearProgressWatch;
    const scheduleProgressWatch = () => {
      if (
        progressTimer !== null ||
        audioRef.current !== audio ||
        audio.paused ||
        audio.ended ||
        (audio.seeking && !ownsProgressNudge()) ||
        audio.playbackRate <= 0
      )
        return;
      progressTimer = setTimeout(() => {
        progressTimer = null;
        if (audioRef.current !== audio) return;
        const source = audio.currentSrc || audio.src;
        const owned = bufferedSourceRef.current;
        const ownsNudge = ownsProgressNudge();
        const shouldProgress =
          !pendingResolutionRef.current &&
          !isTransitioningTrackRef.current &&
          isPlayingRef.current &&
          !audio.paused &&
          !audio.ended &&
          (!audio.seeking || ownsNudge) &&
          audio.playbackRate > 0 &&
          owned?.audio === audio &&
          owned.url === source &&
          (ownsNudge ||
            (audio.readyState >= 3 &&
              (!Number.isFinite(audio.duration) || audio.duration - audio.currentTime >= 0.5) &&
              hasAudioBufferHeadroom(audio, 0.5)));
        const action = progressWatchdogRef.current.observe({
          requestId: streamRequestIdRef.current,
          source,
          position: audio.currentTime,
          now: performance.now(),
          shouldProgress,
        });
        if (action) {
          PlaybackLogger.warn('[AudioPlayer:DecoderStall] Buffered playback stopped progressing', {
            requestId: streamRequestIdRef.current,
            trackId: currentTrackRef.current?.id,
            action,
            position: Math.round(audio.currentTime),
          });
          if (action === 'nudge') {
            progressNudge = {
              requestId: streamRequestIdRef.current,
              source,
              target: audio.currentTime + 0.001,
            };
            try {
              assigningProgressNudge = true;
              audio.currentTime = progressNudge.target;
              // Media clocks can quantize the assigned seek position.
              if (progressNudge) progressNudge.target = audio.currentTime;
            } catch {
              progressNudge = null;
              handleErrorRef.current(true, audio.currentTime);
            } finally {
              assigningProgressNudge = false;
            }
          } else if (action === 'reload') {
            progressNudge = null;
            handleErrorRef.current(true, audio.currentTime);
          } else {
            samplePlayback(audio, true);
            savePlaybackSession(true);
            invalidatePlayback();
            resumeNeedsResolveRef.current = true;
            isPlayingRef.current = false;
            setIsPlaying(false);
            setIsLoadingTrack(false);
            audio.pause();
            emitToast(
              'Воспроизведение зависло. Нажмите «Воспроизвести», чтобы попробовать снова.',
              'warning',
              5000,
            );
          }
        }
        scheduleProgressWatch();
      }, 1000);
    };
    const handleProgressPause = () => {
      if (audio.paused || audio.ended) clearProgressWatch();
    };
    const handleProgressSeek = () => {
      if (ownsProgressNudge()) scheduleProgressWatch();
      else clearProgressWatch();
    };
    const handleProgressReset = () => clearProgressWatch();
    const handleProgressSeeked = () => {
      progressNudge = null;
      scheduleProgressWatch();
    };
    const handleProgressRate = () => {
      clearProgressWatch();
      scheduleProgressWatch();
    };
    const progressStarts = ['play', 'playing'];
    progressStarts.forEach((event) => audio.addEventListener(event, scheduleProgressWatch));
    audio.addEventListener('pause', handleProgressPause);
    audio.addEventListener('ended', handleProgressPause);
    audio.addEventListener('seeking', handleProgressSeek);
    audio.addEventListener('seeked', handleProgressSeeked);
    audio.addEventListener('loadstart', handleProgressReset);
    audio.addEventListener('emptied', handleProgressReset);
    audio.addEventListener('ratechange', handleProgressRate);
    scheduleProgressWatch();

    const handleBufferUpdate = () => {
      if (audioRef.current !== audio) return;
      const ranges = readAudioBufferedRanges(audio, bufferedSourceRef.current);
      setBufferedRanges((prev) => (sameBufferedRanges(prev, ranges) ? prev : ranges));
    };
    const handleBufferReset = () => {
      if (audioRef.current === audio) setBufferedRanges((prev) => (prev.length ? [] : prev));
    };
    const bufferEvents = [
      'progress',
      'loadeddata',
      'loadedmetadata',
      'durationchange',
      'canplay',
      'seeked',
      'timeupdate',
    ];
    bufferEvents.forEach((event) => audio.addEventListener(event, handleBufferUpdate));
    audio.addEventListener('loadstart', handleBufferReset);
    audio.addEventListener('emptied', handleBufferReset);
    handleBufferUpdate();

    const handleTimeUpdate = () => {
      if (audioRef.current !== audio) return;
      if (audio) {
        if (audio.currentTime > 0) clearStalledRecoveryTimer();
        if (pendingPositionRef.current && audio.currentTime + 0.25 < pendingPositionRef.current)
          return;
        pendingPositionRef.current = null;
        lastPositionRef.current = audio.currentTime;
        setCurrentTime(audio.currentTime);
        samplePlayback(audio);
        savePlaybackSession();

        // Resolve the immediate next song as soon as playback is stable; leave bulk work for later.
        if (
          !pendingResolutionRef.current &&
          !audio.paused &&
          audio.readyState >= 3 &&
          audio.currentTime >= 2 &&
          hasAudioBufferHeadroom(audio)
        ) {
          const trackId = currentTrackRef.current?.id;
          prefetchUpcomingTrack();
          if (
            trackId &&
            audio.currentTime >= 10 &&
            lookaheadTriggeredForTrackRef.current !== trackId
          ) {
            lookaheadTriggeredForTrackRef.current = trackId;
            audioCacheService.getOrFetchBlobUrl(trackId, audio.src).catch(() => {});
          }
          if (audio.currentTime >= 10) {
            prefetchUpcomingTrack(true);
          }
        }

        // Smooth crossfade fade-out when near track end
        const crossfadeSec = crossfadeDurationRef.current;
        if (
          shouldTriggerNearEndFade(
            audio.currentTime,
            audio.duration,
            crossfadeSec,
            isCrossfadingRef.current,
            {
              isPlaying: !audio.paused,
              repeatOne: repeatModeRef.current === 'one',
              stopAtEnd: sleepTimerModeRef.current === 'end_of_track',
            },
          )
        ) {
          const hasNext =
            isShuffleRef.current && !isWaveActiveRef.current
              ? shuffleCycleRef.current.hasNext(
                  queueRef.current,
                  queueEntryKey(currentTrackRef.current ?? undefined),
                  repeatModeRef.current === 'all',
                )
              : queueIndexRef.current + 1 < queueRef.current.length ||
                repeatModeRef.current === 'all';
          if (hasNext) {
            isCrossfadingRef.current = true;
            automaticCrossfadeRef.current = true;
            nextTrackRef.current();
          }
        }
      }
    };

    const handleDurationChange = () => {
      if (audioRef.current !== audio) return;
      if (
        audio &&
        audio.duration &&
        !isNaN(audio.duration) &&
        isFinite(audio.duration) &&
        audio.duration > 0
      ) {
        const rounded = Math.round(audio.duration);
        setDuration(rounded);

        const trk = currentTrackRef.current;
        if (trk && (!trk.duration || trk.duration === DEFAULT_TRACK_DURATION)) {
          trk.duration = rounded;
          setCurrentTrack((prev) => (prev ? { ...prev, duration: rounded } : null));
          setQueue((prevQueue) =>
            prevQueue.map((t) =>
              String(t.id) === String(trk.id) ? { ...t, duration: rounded } : t,
            ),
          );
        }
      }
    };

    const handleEnded = () => {
      if (audioRef.current !== audio) return;
      // The previous source can finish while its replacement is still resolving.
      if (isTransitioningTrackRef.current) return;
      audioCacheService.setPlaybackActive(false);
      finishPlaybackSession(audio, repeatModeRef.current === 'one', true);
      clearStalledRecoveryTimer();
      cancelFade();
      isCrossfadingRef.current = false;

      // Sleep timer: End of track mode
      if (shouldStopOnTrackEnd()) {
        setIsPlaying(false);
        emitToast(
          'Таймер сна: трек завершён, воспроизведение остановлено. Приятных снов! 😴',
          'info',
          5000,
        );
        return;
      }

      if (repeatModeRef.current === 'one') {
        lastHistoryRequestIdRef.current = -1;
        const trk = currentTrackRef.current;
        if (trk) startPlaybackSession(trk);
        audio.currentTime = 0;
        audio
          .play()
          .then(() => {
            const crossfadeSeconds = crossfadeDurationRef.current;
            if (crossfadeSeconds > 0 && !isMutedRef.current && volumeRef.current > 0) {
              fadeIn(Math.min(crossfadeSeconds, 2.5));
            } else {
              audio.volume = isMutedRef.current ? 0 : volumeRef.current;
            }
          })
          .catch(console.error);
      } else {
        nextTrackRef.current();
      }
    };

    const handlePlay = () => {
      if (audioRef.current !== audio || pendingResolutionRef.current) return;
      if (audio.paused) return;
      if (!crossfadeRef.current.active && !isTransitioningTrackRef.current) {
        cancelFade();
        audio.volume = isMutedRef.current ? 0 : volumeRef.current;
      }
      setIsPlaying(true);
      isPlayingRef.current = true;
      setIsLoadingTrack(false);
      const session = playbackSessionRef.current;
      if (session && !session.finalized) {
        session.lastPosition = audio.currentTime;
        session.lastWallTime = performance.now();
      }

      const trk = currentTrackRef.current;
      const requestId = streamRequestIdRef.current;
      if (trk && shouldRecordListeningStart(requestId, lastHistoryRequestIdRef.current)) {
        lastHistoryRequestIdRef.current = requestId;
        const artistName =
          typeof trk.artist === 'object' ? trk.artist?.name || '' : String(trk.artist || '');
        const cover =
          trk.album?.cover_medium ||
          trk.album?.cover_xl ||
          trk.album?.cover_big ||
          trk.album?.cover ||
          '';
        platformBridge
          .addListeningHistory({
            track_id: trk.id,
            title: trk.title,
            artist: artistName,
            album: trk.album?.title || '',
            cover_url: cover,
            source: detectTrackSource(trk),
            duration: trk.duration || DEFAULT_TRACK_DURATION,
          })
          .catch(() => {});
      }
    };

    const handlePause = () => {
      if (audioRef.current !== audio) return;
      clearStalledRecoveryTimer();
      samplePlayback(audio, true);
      savePlaybackSession(true);
      if (isTransitioningTrackRef.current) return;
      // A pause event queued for the previous source can arrive after the next one starts.
      if (!audio.paused) return;
      audioCacheService.setPlaybackActive(false);
      setIsPlaying(false);
      isPlayingRef.current = false;
    };

    const handleSeeking = () => {
      if (audioRef.current !== audio) return;
      const session = playbackSessionRef.current;
      if (session && !session.finalized) {
        session.lastPosition = audio.currentTime;
        session.lastWallTime = performance.now();
      }
    };

    const handleErrorFallbackSkip = (trk: Track | null, requestId: number) => {
      const isCurrentError = () =>
        isCurrentPlaybackRequest(
          requestId,
          streamRequestIdRef.current,
          trk?.id,
          currentTrackRef.current?.id,
        );
      if (!isCurrentError()) return;
      if (trk && navigator.onLine === false) {
        holdTemporaryFailure('network', trk);
        return;
      }
      pendingResolutionRef.current = false;
      const canSkip = isWaveActiveRef.current || queueRef.current.length > 1;
      const stopFailedAudio = () => {
        finishPlaybackSession(audio);
        isTransitioningTrackRef.current = false;
        resumeNeedsResolveRef.current = true;
        setIsPlaying(false);
        setIsLoadingTrack(false);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      };
      const markUnavailable = () => {
        if (!isCurrentError()) return;
        stopFailedAudio();
        const message = trk
          ? `Трек «${trk.title}» недоступен${canSkip ? '. Включаем следующий...' : '.'}`
          : `Не удалось воспроизвести трек${canSkip ? '. Переключаем...' : '.'}`;
        emitToast(message, 'warning', 3000);
        if (canSkip)
          schedulePlaybackRecovery(requestId, () => {
            if (isCurrentError()) nextTrackRef.current();
          });
      };
      consecutivePlaybackErrorsRef.current++;
      if (shouldHaltPlaybackOnConsecutiveErrors(consecutivePlaybackErrorsRef.current)) {
        stopFailedAudio();
        isTransitioningTrackRef.current = false;
        emitToast(
          'Не удалось воспроизвести несколько треков подряд. Проверьте подключение к сети.',
          'error',
          4000,
        );
        return;
      }
      if (
        !trk ||
        detectTrackSource(trk) === 'youtube' ||
        !isPlayableStreamForTrack(trk.preview, trk) ||
        audio.src === trk.preview
      ) {
        markUnavailable();
        return;
      }
      mainHlsRef.current?.destroy();
      mainHlsRef.current = null;
      audio.pause();
      resetBufferedRanges();
      audio.src = trk.preview;
      bufferedSourceRef.current = { audio, url: audio.src };
      audio.currentTime = 0;
      audio
        .play()
        .then(() => {
          if (!isCurrentError()) return;
          setIsPlaying(true);
          setIsLoadingTrack(false);
        })
        .catch(markUnavailable);
    };

    const handleStreamRecoveryFailure = (
      error: unknown,
      trk: Track,
      requestId: number,
      resumeAt?: number,
    ) => {
      if (
        !isCurrentPlaybackRequest(
          requestId,
          streamRequestIdRef.current,
          trk.id,
          currentTrackRef.current?.id,
        )
      )
        return;
      pendingResolutionRef.current = false;
      setIsLoadingTrack(false);
      const temporaryFailure =
        getStreamResolveFailure(error) ||
        (error instanceof StreamResolveTimeoutError ? 'timeout' : null);
      if (temporaryFailure || navigator.onLine === false) {
        holdTemporaryFailure(temporaryFailure || 'network', trk, resumeAt);
        return;
      }
      const accessError = getYouTubeAudioAccessError(error);
      if (!accessError) {
        handleErrorFallbackSkip(trk, requestId);
        return;
      }
      finishPlaybackSession(audio);
      isTransitioningTrackRef.current = false;
      setIsPlaying(false);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      if (!emitYouTubeAccessIssue({ reason: accessError, source: 'track', trackId: trk.id })) {
        emitToast(youtubeAudioAccessMessage(accessError), 'warning', 6000);
      }
    };
    const renewFailedStream = (
      track: Track,
      requestId: number,
      resumeAt: number | undefined,
      options: StreamResolveOptions,
      allowPreview: boolean,
    ) => {
      pendingResolutionRef.current = true;
      void recoverPlayerStream(
        {
          track: { ...track, source: detectTrackSource(track) },
          options,
          signal: playbackAbortRef.current.signal,
          allowPreview,
        },
        {
          resolve: (item, settings, signal) =>
            platformBridge.getFullStreamUrl(item, settings, signal),
          isCurrent: () =>
            isCurrentPlaybackRequest(
              requestId,
              streamRequestIdRef.current,
              track.id,
              currentTrackRef.current?.id,
            ),
          isPlayable: isPlayableStreamForTrack,
          resolved: () => {
            pendingResolutionRef.current = false;
            setIsLoadingTrack(false);
          },
          load: (url) => {
            resolvedStreamCache.current.set(String(track.id), { url, timestamp: Date.now() });
            if (!audioRef.current) return;
            handledMediaErrorRef.current = null;
            loadStreamIntoAudio(audioRef.current, mainHlsRef, url, resumeAt, false, track.id, true);
          },
          preview: (url) => {
            if (!audioRef.current) return;
            audioRef.current.pause();
            resetBufferedRanges();
            audioRef.current.src = url;
            bufferedSourceRef.current = { audio: audioRef.current, url: audioRef.current.src };
            audioRef.current.play().catch(() => {
              if (
                isCurrentPlaybackRequest(
                  requestId,
                  streamRequestIdRef.current,
                  track.id,
                  currentTrackRef.current?.id,
                )
              )
                handleErrorFallbackSkip(track, requestId);
            });
          },
          unavailable: () => handleErrorFallbackSkip(track, requestId),
          failed: (error) => handleStreamRecoveryFailure(error, track, requestId, resumeAt),
        },
      );
    };

    const handleError = (
      failedLoad?: Event | true,
      resumePosition?: number,
      temporaryFailure?: StreamResolveFailure,
    ) => {
      if (audioRef.current !== audio || pendingResolutionRef.current) return;
      // A queued DOM event from the detached source has no current MediaError.
      if (failedLoad !== true && failedLoad && !audio.error) return;
      clearStalledRecoveryTimer();
      // Guard against synthetic empty/cleared src errors triggered when pausing or clearing audio
      if (
        failedLoad !== true &&
        (!audio.getAttribute('src') ||
          !audio.src ||
          audio.error?.message?.includes('Empty src attribute') ||
          (audio.error?.code === 4 && (!audio.currentSrc || audio.src.endsWith('index.html'))))
      ) {
        return;
      }

      const trk = currentTrackRef.current;
      // HLS uses a blob MediaSource too; only cache-owned blobs are offline files.
      const isCachedBlob = Boolean(
        trk &&
        audio.src.startsWith('blob:') &&
        (audioCacheService.getCachedBlobUrl(trk.id) === audio.src ||
          offlineCacheService.ownsBlobUrl(audio.src)),
      );
      if (
        trk &&
        navigator.onLine === false &&
        !(isCachedBlob && isCachedAudioDecodeError(audio.error))
      ) {
        holdTemporaryFailure('network', trk, resumePosition ?? audio.currentTime);
        return;
      }
      const isYouTubeTrack = Boolean(trk && detectTrackSource(trk) === 'youtube');
      if (trk) rejectedStreamTracksRef.current.add(String(trk.id));
      const requestId = streamRequestIdRef.current;
      const errCode = audio.error?.code ?? null;
      const errorSource = audio.currentSrc || audio.src;
      const interruptedAt = resumePosition ?? audio.currentTime;
      const resumeAt =
        Number.isFinite(interruptedAt) && interruptedAt > 0 ? interruptedAt : undefined;
      const previousError = handledMediaErrorRef.current;
      if (
        previousError?.requestId === requestId &&
        previousError.source === errorSource &&
        previousError.code === errCode &&
        Date.now() - previousError.handledAt < 500
      ) {
        return;
      }
      handledMediaErrorRef.current = {
        requestId,
        source: errorSource,
        code: errCode,
        handledAt: Date.now(),
      };
      const errMsg = audio.error?.message;
      const codeMap: Record<number, string> = {
        1: 'MEDIA_ERR_ABORTED',
        2: 'MEDIA_ERR_NETWORK',
        3: 'MEDIA_ERR_DECODE',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
      };
      const codeName = errCode ? codeMap[errCode] || `CODE_${errCode}` : 'UNKNOWN';
      PlaybackLogger.error(
        `[AudioPlayer:Error] HTML5 error on "${trk?.title || 'Unknown'}": ${codeName} (${errCode || 0})${errMsg ? ` - ${errMsg}` : ''}, src=${getSafeAudioSourceLabel(errorSource)}`,
      );
      console.warn('Audio playback error encountered:', errCode, errMsg);
      setIsLoadingTrack(false);

      // Retry failed offline files without resetting the HLS source recovery budget.
      if (trk && isCachedBlob) {
        const badUrl = audio.src;
        console.warn('[AudioContext] Playback error on blob: URL for:', trk.title);
        const damaged = isCachedAudioDecodeError(audio.error);
        if (damaged) audioCacheService.discardByUrl(badUrl);
        if (damaged && offlineCacheService.ownsBlobUrl(badUrl)) {
          console.warn(
            '[AudioContext] Offline cached blob is corrupted for:',
            trk.title,
            '— removing entry',
          );
          offlineCacheService.forgetBlobUrl(badUrl);
          offlineCacheService.removeCachedTrack(trk.id).catch(() => {});
          refreshCachedTracks();
        }

        resolvedStreamCache.current.delete(String(trk.id));
        streamRetryCountRef.current = 0;
        if (navigator.onLine === false) {
          holdTemporaryFailure('network', trk, resumeAt);
          return;
        }

        emitToast(
          damaged
            ? 'Офлайн кэш повреждён, подключаемся к онлайн потоку...'
            : 'Не удалось запустить скачанный трек. Пробуем онлайн поток...',
          'warning',
          3000,
        );
        renewFailedStream(
          trk,
          requestId,
          resumeAt,
          { forceRefresh: true, allowSessionRecovery: true },
          false,
        );
        return;
      }

      const retryLimit = isYouTubeTrack ? 2 : 1;
      if (streamRetryCountRef.current < retryLimit && trk) {
        const retryNumber = ++streamRetryCountRef.current;
        resolvedStreamCache.current.delete(String(trk.id));
        setIsLoadingTrack(true);
        emitToast(
          retryNumber === 1
            ? 'Поток не отвечает, обновляем ссылку...'
            : 'Пробуем другой формат этого трека...',
          'warning',
          3000,
        );
        console.warn(
          '[AudioContext] Audio stream error encountered. Auto re-fetching stream URL for:',
          trk.title,
        );
        renewFailedStream(
          trk,
          requestId,
          resumeAt,
          {
            forceRefresh: true,
            allowSessionRecovery: true,
            preferAlternateFormat:
              (isYouTubeTrack && retryNumber > 1) || detectTrackSource(trk) === 'soundcloud',
            excludeItag: isYouTubeTrack && retryNumber > 1 ? getAudioItag(errorSource) : undefined,
          },
          !isYouTubeTrack,
        );
        return;
      }

      if (trk) resolvedStreamCache.current.delete(String(trk.id));
      if (temporaryFailure && trk) {
        holdTemporaryFailure(temporaryFailure, trk, resumeAt);
        return;
      }
      handleErrorFallbackSkip(trk, requestId);
    };

    handleErrorRef.current = handleError;
    handleUnavailableStreamRef.current = handleErrorFallbackSkip;

    const handlePlaying = () => {
      if (audioRef.current !== audio || pendingResolutionRef.current) return;
      if (audio.paused) return;
      cancelTemporaryRetry();
      temporaryRecoveryRef.current = null;
      const recoveryAttempt = temporaryRetryAttemptRef.current;
      temporaryRetryAttemptRef.current = 0;
      consecutivePlaybackErrorsRef.current = 0;
      setPlaybackIssue(null);
      audioCacheService.setPlaybackBuffering(false);
      audioCacheService.setPlaybackActive(true);
      offlineCacheService.releaseUnusedTrackUrls([audio.src, crossfadeRef.current.sourceUrl]);
      clearStalledRecoveryTimer();
      isTransitioningTrackRef.current = false;
      trackTransitionTimestampRef.current = 0;
      setIsLoadingTrack(false);
      streamRetryCountRef.current = 0;
      handledMediaErrorRef.current = null;
      const trk = currentTrackRef.current;
      if (trk) rejectedStreamTracksRef.current.delete(String(trk.id));
      const requestId = streamRequestIdRef.current;
      const bufferingMs = bufferingStartedAtRef.current
        ? Math.max(0, Date.now() - bufferingStartedAtRef.current)
        : 0;
      bufferingStartedAtRef.current = 0;
      // 'playing' also fires on seek/resume/buffer recovery; it is not a new track start.
      if (lastLoggedPlaybackRequestRef.current === requestId) {
        PlaybackLogger.info('[AudioPlayer:Resumed] Playback continued', {
          event: 'playback-resume',
          trackId: trk?.id,
          requestId,
          bufferingMs,
        });
        return;
      }
      lastLoggedPlaybackRequestRef.current = requestId;
      const latencyStr = trackClickTimestampRef.current
        ? ` (${Date.now() - trackClickTimestampRef.current}ms from click)`
        : '';
      PlaybackLogger.info(
        `[AudioPlayer:Playing] "${trk?.title || 'Unknown'}" started playback${latencyStr} [duration: ${Math.round(audio.duration || 0)}s]`,
        {
          event: 'playback-start',
          requestId,
          elapsedMs: Math.max(0, Date.now() - trackClickTimestampRef.current),
          attempt: recoveryAttempt,
          trackId: trk?.id,
          source: trk ? detectTrackSource(trk) : 'unknown',
          delivery:
            mainHlsRef.current || audio.src.includes('.m3u8')
              ? 'hls'
              : audio.src.startsWith('blob:')
                ? 'local-cache'
                : 'progressive',
        },
      );
    };

    const handleWaiting = () => {
      if (audioRef.current !== audio || pendingResolutionRef.current) return;
      audioCacheService.setPlaybackBuffering(true);
      prefetchTriggeredForTrackRef.current = null;
      lookaheadTriggeredForTrackRef.current = null;
      prefetchLookaheadTargetRef.current = null;
      prefetchPlanRef.current = null;
      const trk = currentTrackRef.current;
      if (!bufferingStartedAtRef.current) {
        bufferingStartedAtRef.current = Date.now();
        PlaybackLogger.info(
          `[AudioPlayer:Buffering] Buffering audio for "${trk?.title || 'Unknown'}" (readyState: ${audio.readyState})`,
          { requestId: streamRequestIdRef.current, trackId: trk?.id },
        );
      }
      scheduleStalledRecovery();
    };

    const scheduleStalledRecovery = () => {
      if (stalledRecoveryTimerRef.current !== null || audio.paused) return;
      const track = currentTrackRef.current;
      const requestId = streamRequestIdRef.current;
      const trackId = track?.id;
      const stalledSource = audio.currentSrc || audio.src;
      const startTime = audio.currentTime;
      if (!track || !stalledSource) return;

      stalledRecoveryTimerRef.current = setTimeout(() => {
        stalledRecoveryTimerRef.current = null;
        const currentTrack = currentTrackRef.current;
        const currentSource = audio.currentSrc || audio.src;
        const isSameRequest = isCurrentPlaybackRequest(
          requestId,
          streamRequestIdRef.current,
          trackId,
          currentTrack?.id,
        );
        const madePlaybackProgress = audio.currentTime > startTime + 0.25;
        if (
          !isSameRequest ||
          currentSource !== stalledSource ||
          audio.paused ||
          audio.readyState >= 3 ||
          madePlaybackProgress
        ) {
          return;
        }

        PlaybackLogger.warn(
          `[AudioPlayer:Stalled] No playable data for "${currentTrack?.title || 'Unknown'}" after 8s; retrying the stream`,
        );
        handleErrorRef.current?.(true, audio.currentTime, 'timeout');
      }, 8000);
    };

    const handleStalled = () => {
      if (audioRef.current !== audio) return;
      const trk = currentTrackRef.current;
      PlaybackLogger.warn(
        `[AudioPlayer:Stalled] Audio stalled for "${trk?.title || 'Unknown'}" (readyState: ${audio.readyState})`,
      );
      scheduleStalledRecovery();
    };

    const handleCanPlay = () => {
      if (audioRef.current !== audio) return;
      clearStalledRecoveryTimer();
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleDurationChange);
    audio.addEventListener('durationchange', handleDurationChange);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('seeking', handleSeeking);
    audio.addEventListener('error', handleError);
    if (!audio.paused) {
      handlePlay();
      handlePlaying();
    }

    return () => {
      clearProgressWatch();
      if (resetProgressWatchRef.current === clearProgressWatch)
        resetProgressWatchRef.current = () => {};
      progressStarts.forEach((event) => audio.removeEventListener(event, scheduleProgressWatch));
      audio.removeEventListener('pause', handleProgressPause);
      audio.removeEventListener('ended', handleProgressPause);
      audio.removeEventListener('seeking', handleProgressSeek);
      audio.removeEventListener('seeked', handleProgressSeeked);
      audio.removeEventListener('loadstart', handleProgressReset);
      audio.removeEventListener('emptied', handleProgressReset);
      audio.removeEventListener('ratechange', handleProgressRate);
      bufferEvents.forEach((event) => audio.removeEventListener(event, handleBufferUpdate));
      audio.removeEventListener('loadstart', handleBufferReset);
      audio.removeEventListener('emptied', handleBufferReset);
      if (audioRef.current === audio) finishPlaybackSession(audio);
      if (audioRef.current === audio && mainHlsRef.current) {
        mainHlsRef.current.destroy();
        mainHlsRef.current = null;
      }

      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleDurationChange);
      audio.removeEventListener('durationchange', handleDurationChange);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('seeking', handleSeeking);
      audio.removeEventListener('error', handleError);
      clearStalledRecoveryTimer();
      if (!crossfadeRef.current.owns(audio)) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
      }
    };
  }, [
    audioElement,
    audioRef,
    schedulePlaybackRecovery,
    isShuffleRef,
    shuffleCycleRef,
    cancelFade,
    crossfadeDurationRef,
    fadeIn,
    fadeOut,
    finishPlaybackSession,
    isCrossfadingRef,
    isMutedRef,
    isScrobblingRef,
    isWaveActiveRef,
    loadStreamIntoAudio,
    prefetchUpcomingTrack,
    queueIndexRef,
    queueRef,
    refreshCachedTracks,
    resetBufferedRanges,
    repeatModeRef,
    samplePlayback,
    savePlaybackSession,
    startPlaybackSession,
    setQueue,
    shouldStopOnTrackEnd,
    sleepTimerModeRef,
    volumeRef,
    invalidatePlayback,
    playbackAbortRef,
    setQueueIndex,
    fetchMoreWaveTracks,
    holdTemporaryFailure,
    cancelTemporaryRetry,
    compactWaveQueue,
  ]);

  // Play full track with automatic queue management
  const playTrack = useCallback(
    async (
      track: Track,
      newQueue?: Track[],
      fromWave = false,
      resumePosition?: number,
      origin?: PlaybackOrigin,
    ) => {
      if (newQueue) {
        const context =
          normalizePlaybackOrigin(origin) ||
          (fromWave ? { kind: 'wave' as const } : { kind: 'manual' as const });
        newQueue = newQueue.map((item) => withPlaybackOrigin(item, context));
        track = withPlaybackOrigin(track, context);
      } else if (origin) track = withPlaybackOrigin(track, origin);
      invalidatePlaybackIntent();
      const startPosition =
        typeof resumePosition === 'number' && Number.isFinite(resumePosition)
          ? Math.max(0, Math.min(resumePosition, track.duration || Infinity))
          : 0;
      if (isYouTubeItemDisabled(track)) {
        const available = newQueue?.find((candidate) => !isYouTubeItemDisabled(candidate));
        if (!available) return;
        track = available;
      }
      const temporaryRetry = retryingTemporaryFailureRef.current;
      retryingTemporaryFailureRef.current = false;
      cancelTemporaryRetry();
      temporaryRecoveryRef.current = null;
      setPlaybackIssue(null);
      if (!temporaryRetry) temporaryRetryAttemptRef.current = 0;
      const clickStartTime = Date.now();
      trackClickTimestampRef.current = clickStartTime;
      bufferingStartedAtRef.current = 0;

      const artistName =
        track.artist?.name ||
        (typeof track.artist === 'string' ? track.artist : '') ||
        'Unknown Artist';

      PlaybackLogger.info(
        `[Track:Click] "${track.title}" by "${artistName}" (id: ${track.id}, source: ${track.source || 'auto'}, wave: ${Boolean(fromWave)})`,
      );

      // If a snippet is currently playing, immediately stop it
      stopSnippetRef.current?.();
      cancelFade();
      isCrossfadingRef.current = false;
      // Automatic queue navigation must not reset the consecutive-error guard.

      // Check if this track is within the existing wave queue
      const isNavigatingWaveQueue =
        isWaveActiveRef.current &&
        !isWaveStartingRef.current &&
        !newQueue &&
        queueRef.current.some((t) => String(t.id) === String(track.id));

      if (fromWave || isNavigatingWaveQueue) {
        setIsWaveActive(true);
        isWaveActiveRef.current = true;
      } else {
        stopWave();
        setIsWaveActive(false);
        isWaveActiveRef.current = false;
      }

      let audio = audioRef.current;
      if (!audio) return;
      const overlap = automaticCrossfadeRef.current;
      automaticCrossfadeRef.current = false;
      if (!temporaryRetry) finishPlaybackSession(audio);
      if (overlap && !audio.paused) {
        const outgoingAudio = audio;
        const outgoingHls = mainHlsRef.current;
        const outgoingUrl = audio.src;
        crossfadeRef.current.hold(
          audio,
          () => {
            releasePlayerAudio(outgoingAudio);
            outgoingHls?.destroy();
            if (outgoingUrl !== audioRef.current?.src)
              offlineCacheService.forgetBlobUrl(outgoingUrl);
          },
          () => (isMutedRef.current ? 0 : volumeRef.current),
        );
        mainHlsRef.current = null;
        isCrossfadingRef.current = true;
        audio = createPlayerAudio();
        audio.preload = 'auto';
        audio.autoplay = false;
        audioRef.current = audio;
        setAudioElement(audio);
      } else {
        crossfadeRef.current.stop();
      }

      if (stalledRecoveryTimerRef.current !== null) {
        clearTimeout(stalledRecoveryTimerRef.current);
        stalledRecoveryTimerRef.current = null;
      }

      resetBufferedRanges();
      // Mark track transition in progress to prevent intermediate pause events from desyncing state
      isTransitioningTrackRef.current = true;
      trackTransitionTimestampRef.current = Date.now();
      streamLoadIdRef.current += 1;

      cancelScheduledRecovery();
      pendingResolutionRef.current = true;
      resumeNeedsResolveRef.current = false;
      invalidatePlayback();
      const currentRequestId = streamRequestIdRef.current;
      PlaybackLogger.info('[Track:Request] Playback request allocated', {
        requestId: currentRequestId,
        trackId: track.id,
        source: track.source,
        reason: temporaryRetry ? 'automatic-retry' : 'selection',
        attempt: temporaryRetryAttemptRef.current,
      });
      pendingSeekCleanupRef.current.get(audio)?.();
      audioCacheService.setPlaybackBuffering(
        true,
        rejectedStreamTracksRef.current.has(String(track.id))
          ? undefined
          : { trackId: track.id, signal: playbackAbortRef.current.signal },
      );
      mainHlsRef.current?.destroy();
      mainHlsRef.current = null;
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsLoadingTrack(true);

      const selection = selectPlayerQueue(
        queueRef.current,
        queueIndexRef.current,
        track,
        newQueue,
        typeof resumePosition === 'number',
      );
      if (selection.resetShuffle) shuffleCycleRef.current.reset();
      let updatedQueue = selection.queue;
      let newIndex = selection.index;
      if (updatedQueue !== queueRef.current || newQueue) {
        setQueue(updatedQueue);
        queueRef.current = updatedQueue;
      }
      const selectedIndex = Math.max(0, newIndex);
      setQueueIndex(selectedIndex);
      queueIndexRef.current = selectedIndex;

      newIndex = compactWaveQueue(newIndex);
      updatedQueue = queueRef.current;
      track = updatedQueue[newIndex] ?? track;
      if (!isWaveActiveRef.current)
        shuffleCycleRef.current.visit(updatedQueue, queueEntryKey(track));

      // Proactively replenish wave queue when near or at the end of the queue
      if (isWaveActiveRef.current && updatedQueue.length - newIndex <= 5) {
        fetchMoreWaveTracks();
      }

      const effectiveSource = detectTrackSource(track);
      track.source = effectiveSource;

      const isYouTube =
        effectiveSource === 'youtube' ||
        String(track.id).startsWith('yt_') ||
        Boolean(
          track.preview &&
          (track.preview.includes('youtube.com') || track.preview.includes('youtu.be')),
        );

      preparePlayerAudio(audio, track);
      currentTrackRef.current = track;
      pendingPositionRef.current = startPosition;
      lastPositionRef.current = startPosition;
      if (!temporaryRetry) startPlaybackSession(track, startPosition);
      setCurrentTrack(track);
      setCurrentTime(startPosition);
      setDuration(track.duration || DEFAULT_TRACK_DURATION);

      streamRetryCountRef.current = 0;
      handledMediaErrorRef.current = null;

      const cachedSource = await readCachedPlayerSource(track, {
        offlineUrl: (id) => offlineCacheService.getCachedTrackUrl(id),
        memoryUrl: (id) => audioCacheService.getCachedBlobUrl(id),
        isCurrent: () => currentRequestId === streamRequestIdRef.current,
      });
      if (cachedSource.kind === 'stale') return;
      if (cachedSource.kind === 'offline' || cachedSource.kind === 'memory') {
        if (cachedSource.kind === 'offline') {
          PlaybackLogger.info(
            `[Track:Cache] Hit offline IndexedDB for "${track.title}" in ${Date.now() - clickStartTime}ms`,
          );
          track = cachedSource.track;
          setIsLoadingTrack(false);
        }
        loadStreamIntoAudio(audio, mainHlsRef, cachedSource.url, startPosition, false, track.id);
        // Start audio before touching artwork storage. A late reply belongs only to this request.
        if (cachedSource.kind === 'offline' || offlineCacheService.ownsBlobUrl(cachedSource.url)) {
          void readCachedPlayerCover(track.id, {
            offlineCover: (id) => offlineCacheService.getCachedCoverUrl(id),
            isCurrent: () => currentRequestId === streamRequestIdRef.current,
          }).then((cover) => {
            if (!cover || currentRequestId !== streamRequestIdRef.current) return;
            setCurrentTrack((current) => {
              if (!current || currentRequestId !== streamRequestIdRef.current) return current;
              return {
                ...current,
                cover_url: cover,
                album:
                  current.album && typeof current.album === 'object'
                    ? { ...current.album, cover, cover_medium: cover }
                    : current.album,
              };
            });
          });
        }
        return;
      }
      if (navigator.onLine === false) {
        holdTemporaryFailure('network', track, startPosition);
        return;
      }

      // Check in-memory stream URL cache (non-mutating, Map-based)
      const cached = resolvedStreamCache.current.get(String(track.id));
      const forceRefresh = rejectedStreamTracksRef.current.has(String(track.id));
      if (forceRefresh) resolvedStreamCache.current.delete(String(track.id));
      const isStreamFresh =
        !forceRefresh && cached && Date.now() - cached.timestamp < STREAM_URL_MAX_AGE_MS;

      if (isStreamFresh && cached && isPlayableStreamForTrack(cached.url, track)) {
        PlaybackLogger.info(
          `[Track:Cache] Hit memory stream cache for "${track.title}" in ${Date.now() - clickStartTime}ms`,
        );
        setIsLoadingTrack(false);
        loadStreamIntoAudio(audio, mainHlsRef, cached.url, startPosition, false, track.id);
        return;
      }

      // Resolve full high quality stream directly (hybrid resolver for Desktop and Mobile)
      setIsLoadingTrack(true);
      PlaybackLogger.info(
        `[Track:Resolve] Requesting stream URL from platform bridge for "${track.title}" (source: ${effectiveSource}, id: ${track.id})...`,
      );

      resolvePlayerStream(
        { ...track, source: effectiveSource },
        { forceRefresh, allowSessionRecovery: true },
        playbackAbortRef.current.signal,
        (item, options, signal) => platformBridge.getFullStreamUrl(item, options, signal),
      )
        .then((fullStreamUrl) => {
          if (currentRequestId !== streamRequestIdRef.current) return;
          setIsLoadingTrack(false);

          const targetStreamUrl = isPlayableStreamForTrack(fullStreamUrl, track)
            ? fullStreamUrl
            : !isYouTube && isPlayableStreamForTrack(track.preview, track)
              ? track.preview
              : '';

          const resolveDuration = Date.now() - clickStartTime;

          if (!targetStreamUrl && navigator.onLine === false) {
            holdTemporaryFailure('network', track, startPosition);
            return;
          }
          if (targetStreamUrl) {
            PlaybackLogger.info(
              `[Track:Stream] Resolved stream URL for "${track.title}" in ${resolveDuration}ms (source: ${effectiveSource}): ${getSafeAudioSourceLabel(targetStreamUrl)}`,
            );
            resolvedStreamCache.current.set(String(track.id), {
              url: targetStreamUrl,
              timestamp: Date.now(),
            });
            if (audioRef.current && currentRequestId === streamRequestIdRef.current) {
              loadStreamIntoAudio(
                audioRef.current,
                mainHlsRef,
                targetStreamUrl,
                startPosition,
                false,
                track.id,
              );
            }
          } else {
            PlaybackLogger.warn(
              `[Track:Stream] No playable stream URL returned for "${track.title}" after ${resolveDuration}ms (source: ${effectiveSource})`,
            );
            console.warn('[AudioContext] Stream URL not found for:', track.title);
            handleUnavailableStreamRef.current(track, currentRequestId);
          }
        })
        .catch((err) => {
          if (currentRequestId !== streamRequestIdRef.current) return;
          setIsLoadingTrack(false);
          PlaybackLogger.warn('[Track:Resolve] Stream lookup failed', {
            requestId: currentRequestId,
            trackId: track.id,
            source: effectiveSource,
            elapsedMs: Date.now() - clickStartTime,
            failure:
              getStreamResolveFailure(err) ||
              (err instanceof StreamResolveTimeoutError ? 'timeout' : null) ||
              getYouTubeAudioAccessError(err) ||
              'unavailable',
            error: err,
          });
          const temporaryFailure =
            getStreamResolveFailure(err) ||
            (err instanceof StreamResolveTimeoutError ? 'timeout' : null);
          if (temporaryFailure || navigator.onLine === false) {
            holdTemporaryFailure(temporaryFailure || 'network', track, startPosition);
            return;
          }
          const accessError = getYouTubeAudioAccessError(err);
          if (accessError) {
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.removeAttribute('src');
              audioRef.current.load();
            }
            setIsPlaying(false);
            if (
              !emitYouTubeAccessIssue({ reason: accessError, source: 'track', trackId: track.id })
            ) {
              emitToast(youtubeAudioAccessMessage(accessError), 'warning', 6000);
            }
            return;
          }
          const fallback =
            !isYouTube && isPlayableStreamForTrack(track.preview, track) ? track.preview : '';
          if (fallback && audioRef.current && currentRequestId === streamRequestIdRef.current) {
            loadStreamIntoAudio(
              audioRef.current,
              mainHlsRef,
              fallback,
              startPosition,
              false,
              track.id,
            );
          } else {
            handleUnavailableStreamRef.current(track, currentRequestId);
          }
        });
    },
    [
      audioRef,
      cancelFade,
      cancelScheduledRecovery,
      schedulePlaybackRecovery,
      holdTemporaryFailure,
      cancelTemporaryRetry,
      invalidatePlayback,
      playbackAbortRef,
      fetchMoreWaveTracks,
      finishPlaybackSession,
      isCrossfadingRef,
      isWaveActiveRef,
      isWaveStartingRef,
      loadStreamIntoAudio,
      resetBufferedRanges,
      queueIndexRef,
      queueRef,
      setIsWaveActive,
      setQueue,
      setQueueIndex,
      shuffleCycleRef,
      stopSnippetRef,
      stopWave,
      startPlaybackSession,
      compactWaveQueue,
    ],
  );

  useEffect(() => {
    playTrackRef.current = playTrack;
  }, [playTrack, playTrackRef]);

  useEffect(() => {
    if (!youtubeDisabled) return;
    crossfadeRef.current.stop();
    if (!isYouTubeItemDisabled(currentTrackRef.current)) return;
    invalidatePlayback();
    isTransitioningTrackRef.current = false;
    automaticCrossfadeRef.current = false;
    isCrossfadingRef.current = false;
    crossfadeRef.current.stop();
    cancelFade();
    const audio = audioRef.current;
    if (audio) {
      finishPlaybackSession(audio);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setIsLoadingTrack(false);
    setIsPlaying(false);
    isPlayingRef.current = false;
    stopWave();
  }, [
    youtubeDisabled,
    audioRef,
    invalidatePlayback,
    cancelFade,
    finishPlaybackSession,
    isCrossfadingRef,
    stopSnippetRef,
    stopWave,
  ]);

  // Use the same explicit commands for the player, notification and widget.
  const pauseMainAudio = useCallback(
    (cancelPendingPlayback = true) => {
      playIntentRef.current++;
      cancelTemporaryRetry();
      temporaryRecoveryRef.current = null;
      setPlaybackIssue((issue) => (issue ? { ...issue, autoResume: false } : null));
      if (cancelPendingPlayback && pendingResolutionRef.current) {
        resumeNeedsResolveRef.current = true;
        pendingResolutionRef.current = false;
        invalidatePlayback();
      } else {
        // Preserve a healthy listening session, or the preview request allocated by its controller.
        streamLoadIdRef.current++;
      }
      cancelScheduledRecovery();
      crossfadeRef.current.stop();
      cancelFade();
      isTransitioningTrackRef.current = false;
      trackTransitionTimestampRef.current = 0;
      audioRef.current?.pause();
      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsLoadingTrack(false);
    },
    [audioRef, cancelFade, cancelScheduledRecovery, invalidatePlayback, cancelTemporaryRetry],
  );

  const resumeMainAudio = useCallback(() => {
    if (isYouTubeItemDisabled(currentTrackRef.current)) return;
    crossfadeRef.current.stop();
    if (isSnippetPlayingRef.current) stopSnippetRef.current?.();
    const audio = audioRef.current;
    if (!audio) return;
    if (pendingResolutionRef.current) {
      setIsLoadingTrack(true);
      return;
    }
    cancelScheduledRecovery();
    cancelFade();
    isTransitioningTrackRef.current = false;
    trackTransitionTimestampRef.current = 0;
    applyAudioVolume(audio, volumeRef.current, isMutedRef.current);
    if (!currentTrackRef.current && queueRef.current.length > 0) {
      void playTrack(queueRef.current[0]);
      return;
    }
    if (
      currentTrackRef.current &&
      (resumeNeedsResolveRef.current || !audio.getAttribute('src') || audio.error)
    ) {
      if (playbackIssue) {
        retryingTemporaryFailureRef.current = true;
        temporaryRetryAttemptRef.current = 0;
      }
      void playTrack(currentTrackRef.current, undefined, false, getPlaybackPosition());
      return;
    }
    const intent = ++playIntentRef.current;
    const requestId = streamRequestIdRef.current;
    const loadId = streamLoadIdRef.current;
    const isCurrent = () =>
      intent === playIntentRef.current &&
      audio === audioRef.current &&
      requestId === streamRequestIdRef.current &&
      loadId === streamLoadIdRef.current;
    const started = () => {
      if (!isCurrent()) return;
      setIsPlaying(true);
      isPlayingRef.current = true;
    };
    const failed = (err: unknown) => {
      if (!isCurrent()) return;
      console.warn('[AudioContext] audio.play() failed:', err);
      setIsPlaying(false);
      isPlayingRef.current = false;
      setIsLoadingTrack(false);
    };
    try {
      const pending = audio.play();
      if (pending) pending.then(started, failed);
      else started();
    } catch (err) {
      failed(err);
    }
  }, [
    audioRef,
    cancelFade,
    cancelScheduledRecovery,
    isMutedRef,
    isSnippetPlayingRef,
    playTrack,
    queueRef,
    stopSnippetRef,
    volumeRef,
    getPlaybackPosition,
    playbackIssue,
  ]);

  useEffect(() => {
    retryTemporaryRef.current = () => {
      const recovery = temporaryRecoveryRef.current,
        track = currentTrackRef.current;
      if (
        !recovery ||
        !track ||
        temporaryRetryAttemptRef.current >= 2 ||
        navigator.onLine === false ||
        recovery.requestId !== streamRequestIdRef.current ||
        recovery.intent !== playIntentRef.current ||
        recovery.trackId !== String(track.id) ||
        isSnippetPlayingRef.current
      )
        return;
      cancelTemporaryRetry();
      temporaryRetryAttemptRef.current++;
      PlaybackLogger.info('[Playback:Recovery] Retrying same recording', {
        requestId: recovery.requestId,
        trackId: track.id,
        attempt: temporaryRetryAttemptRef.current,
        position: Math.round(recovery.position),
      });
      retryingTemporaryFailureRef.current = true;
      void playTrack(track, undefined, isWaveActiveRef.current, recovery.position);
    };
    return () => {
      retryTemporaryRef.current = () => {};
    };
  }, [playTrack, cancelTemporaryRetry, isSnippetPlayingRef, isWaveActiveRef]);

  const togglePlay = useCallback(() => {
    invalidatePlaybackIntent();
    if (isWaveStartingRef.current) {
      stopWave();
      return;
    }
    if (isYouTubeItemDisabled(currentTrackRef.current)) return;
    const audio = audioRef.current;
    if (
      pendingResolutionRef.current ||
      isTransitioningTrackRef.current ||
      isPlayingRef.current ||
      (audio && !audio.paused && !audio.ended)
    )
      pauseMainAudio();
    else resumeMainAudio();
  }, [audioRef, pauseMainAudio, resumeMainAudio, isWaveStartingRef, stopWave]);

  // Precise Seek
  const seek = useCallback(
    (seconds: number) => {
      invalidatePlaybackIntent();
      resetProgressWatchRef.current();
      crossfadeRef.current.stop();
      cancelFade();
      isCrossfadingRef.current = false;

      const targetDuration =
        duration || (audioRef.current ? audioRef.current.duration : 180) || 180;
      const clamped = Math.max(0, Math.min(seconds, targetDuration));

      const audio = audioRef.current;
      if (audio) {
        samplePlayback(audio);
        if (!isMutedRef.current) {
          audio.volume = volumeRef.current;
        }
        audio.currentTime = clamped;
        const session = playbackSessionRef.current;
        if (session) {
          session.lastPosition = clamped;
          session.lastWallTime = performance.now();
        }
      }
      lastPositionRef.current = clamped;
      if (pendingPositionRef.current !== null) pendingPositionRef.current = clamped;
      setCurrentTime(clamped);

      // Sync seek position immediately with Discord RPC
      if (window.electronAPI?.updateDiscordRpc && currentTrack) {
        const artistName =
          currentTrack.artist?.name ||
          (typeof currentTrack.artist === 'string' ? currentTrack.artist : '') ||
          'Исполнитель';
        const albumTitle =
          currentTrack.album?.title ||
          (typeof currentTrack.album === 'string' ? currentTrack.album : '') ||
          'SoSo Music';
        const coverUrl = resolveTrackCover(currentTrack, '');

        window.electronAPI.updateDiscordRpc({
          trackId: currentTrack.id,
          source: detectTrackSource(currentTrack),
          title: currentTrack.title || 'Трек',
          artist: artistName,
          album: albumTitle,
          duration: targetDuration,
          currentTime: clamped,
          isPlaying: isPlaying,
          coverUrl: coverUrl,
        });
      }
    },
    [
      audioRef,
      cancelFade,
      currentTrack,
      duration,
      isCrossfadingRef,
      isMutedRef,
      isPlaying,
      samplePlayback,
      volumeRef,
    ],
  );

  const stopQueuePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (audio) finishPlaybackSession(audio);
    resumeNeedsResolveRef.current = true;
    invalidatePlayback();
    automaticCrossfadeRef.current = false;
    isCrossfadingRef.current = false;
    pauseMainAudio();
  }, [audioRef, finishPlaybackSession, invalidatePlayback, isCrossfadingRef, pauseMainAudio]);

  // Next track, including infinite wave queue handling
  const nextTrack = useCallback(async () => {
    invalidatePlaybackIntent();
    const currentTrk = currentTrackRef.current;
    const audio = audioRef.current;

    if (currentTrk && audio && isWaveActiveRef.current && !isWaveStartingRef.current) {
      samplePlayback(audio, true);
      const session = playbackSessionRef.current;
      const listened =
        session && String(session.track.id) === String(currentTrk.id) ? session.playedSeconds : 0;
      // Automatic recovery after a media error is not a negative taste signal.
      if (handledMediaErrorRef.current?.requestId !== streamRequestIdRef.current) {
        recordWavePlayback(
          currentTrk,
          listened,
          Number.isFinite(audio.duration) ? audio.duration : currentTrk.duration,
          audio.ended ? 'ended' : 'skip',
        );
      }
    }

    const q = queueRef.current;
    const qIdx = queueIndexRef.current;
    if (q.length === 0) {
      stopQueuePlayback();
      return;
    }

    let nextIdx: number;

    if (isShuffleRef.current && !isWaveActiveRef.current) {
      nextIdx = -1;
      for (let attempt = 0; attempt < q.length; attempt++) {
        const candidate = shuffleCycleRef.current.next(
          q,
          queueEntryKey(currentTrk ?? undefined),
          repeatModeRef.current === 'all',
        );
        if (candidate < 0) break;
        if (!isYouTubeItemDisabled(q[candidate])) {
          nextIdx = candidate;
          break;
        }
      }
      if (nextIdx < 0) {
        stopQueuePlayback();
        return;
      }
    } else {
      if (qIdx < q.length - 1) {
        nextIdx = qIdx + 1;
      } else if (repeatModeRef.current === 'all' && !isWaveActiveRef.current) {
        nextIdx = 0;
      } else if (isWaveActiveRef.current) {
        setIsLoadingTrack(true);
        const requestId = streamRequestIdRef.current;
        const intent = playIntentRef.current;
        await fetchMoreWaveTracks();
        // A user may have changed track or restarted/stopped the wave while fetching.
        if (
          intent !== playIntentRef.current ||
          requestId !== streamRequestIdRef.current ||
          !isWaveActiveRef.current ||
          isWaveStartingRef.current ||
          queueIndexRef.current !== qIdx ||
          String(currentTrackRef.current?.id) !== String(currentTrk?.id)
        )
          return;
        const index = availableQueueIndex(queueRef.current, qIdx + 1, 1, false);
        const next = queueRef.current[index];
        if (next) {
          setQueueIndex(index);
          playTrack(next, undefined, true);
        } else {
          setIsLoadingTrack(false);
          setIsPlaying(false);
          emitToast('Не удалось загрузить новые треки для волны', 'warning', 3500);
        }
        return;
      } else {
        stopQueuePlayback();
        return;
      }
    }

    nextIdx = availableQueueIndex(
      q,
      nextIdx,
      1,
      repeatModeRef.current === 'all' && !isWaveActiveRef.current,
    );
    if (nextIdx < 0) {
      stopQueuePlayback();
      return;
    }
    if (isWaveActiveRef.current && q.length - nextIdx <= 6) {
      fetchMoreWaveTracks();
    }

    const nextTrk = q[nextIdx];
    if (nextTrk) {
      setQueueIndex(nextIdx);
      playTrack(nextTrk, undefined, isWaveActiveRef.current);
    }
  }, [
    audioRef,
    fetchMoreWaveTracks,
    isShuffleRef,
    isWaveActiveRef,
    isWaveStartingRef,
    playTrack,
    queueIndexRef,
    queueRef,
    recordWavePlayback,
    samplePlayback,
    repeatModeRef,
    setQueueIndex,
    shuffleCycleRef,
    stopQueuePlayback,
  ]);

  useEffect(() => {
    nextTrackRef.current = nextTrack;
  }, [nextTrack]);

  // Previous Track
  const prevTrack = useCallback(() => {
    invalidatePlaybackIntent();
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3 && !isYouTubeItemDisabled(currentTrackRef.current)) {
      finishPlaybackSession(audio);
      if (currentTrackRef.current) startPlaybackSession(currentTrackRef.current);
      audio.currentTime = 0;
      setCurrentTime(0);
      return;
    }

    const q = queueRef.current;
    const qIdx = queueIndexRef.current;
    if (q.length === 0) return;

    let prevIdx: number;
    if (isShuffleRef.current && !isWaveActiveRef.current) {
      prevIdx = -1;
      for (let attempt = 0; attempt < q.length; attempt++) {
        const candidate = shuffleCycleRef.current.previous(
          q,
          queueEntryKey(currentTrackRef.current ?? undefined),
        );
        if (candidate < 0) break;
        if (!isYouTubeItemDisabled(q[candidate])) {
          prevIdx = candidate;
          break;
        }
      }
      if (prevIdx < 0) return;
    } else if (qIdx > 0) {
      prevIdx = qIdx - 1;
    } else if (repeatModeRef.current === 'all') {
      prevIdx = q.length - 1;
    } else {
      prevIdx = 0;
    }

    prevIdx = availableQueueIndex(q, prevIdx, -1, repeatModeRef.current === 'all');
    const prevTrk = q[prevIdx];
    if (prevTrk) {
      setQueueIndex(prevIdx);
      playTrack(prevTrk);
    }
  }, [
    audioRef,
    finishPlaybackSession,
    isShuffleRef,
    isWaveActiveRef,
    playTrack,
    queueIndexRef,
    queueRef,
    repeatModeRef,
    setQueueIndex,
    shuffleCycleRef,
    startPlaybackSession,
  ]);

  useEffect(() => {
    prevTrackRef.current = prevTrack;
  }, [prevTrack]);

  return {
    audioElement,
    getPlaybackPosition,
    currentTrack,
    currentTrackRef,
    isPlaying,
    isPlayingRef,
    isLoadingTrack,
    playbackIssue,
    setIsLoadingTrack,
    setIsPlaying,
    currentTime,
    duration,
    bufferedRanges,
    mainHlsRef,
    streamRequestIdRef,
    resolvedStreamCache,
    isTransitioningTrackRef,
    trackTransitionTimestampRef,
    loadStreamIntoAudio,
    prefetchTrackStream,
    playTrack,
    togglePlay,
    seek,
    nextTrack,
    prevTrack,
    pauseMainAudio,
    resumeMainAudio,
    nextTrackRef,
    prevTrackRef,
  };
}
