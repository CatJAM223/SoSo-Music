import { useYouTubeAvailability } from './useYouTubeAvailability';
import { isYouTubeItemDisabled } from '../services/youtubeAvailability.ts';
import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { Track } from '../types';
import { detectTrackSource } from '../utils/formatters';
import { platformBridge } from '../bridge/platformBridge';
import { isPlayableDirectAudioUrl } from '../utils/audioUrlValidator';
import { getSnippetProgressState } from '../utils/snippetProgress';
import type { AudioLoadOwner } from '../utils/audioStartup';
import type { StreamResolveFailure } from '../utils/streamResolveError';
import { resolvePlayerStream } from '../services/playerStreamResolution';
import { PlaybackLogger } from '../services/playbackLogger';
import { emitToast } from '../context/ToastContext';
import {
  SNIPPET_DURATION,
  DEFAULT_TRACK_DURATION,
  STREAM_URL_MAX_AGE_MS,
} from '../context/audioTypes';

interface UseSnippetControllerProps {
  volume: number;
  isMuted: boolean;
  onPauseMainAudio: () => void;
  resolvedStreamCache: React.MutableRefObject<Map<string, { url: string; timestamp: number }>>;
  loadStreamIntoAudio: (
    audio: HTMLAudioElement,
    hlsRef: React.MutableRefObject<Hls | null>,
    streamUrl: string,
    startSeekSeconds?: number,
    isSnippet?: boolean,
    trackId?: string | number,
    bypassMemoryBlob?: boolean,
    loadOwner?: AudioLoadOwner,
  ) => void;
  streamRequestIdRef: React.MutableRefObject<number>;
}

export function useSnippetController({
  volume,
  isMuted,
  onPauseMainAudio,
  resolvedStreamCache,
  loadStreamIntoAudio,
  streamRequestIdRef,
}: UseSnippetControllerProps) {
  const snippetAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamAbortRef = useRef<AbortController | null>(null);
  const snippetHlsRef = useRef<Hls | null>(null);
  const snippetTrackRef = useRef<Track | null>(null);
  const snippetStartRef = useRef<number>(10);
  const snippetEndRef = useRef<number>(20);
  const snippetLoadVersionRef = useRef(0);
  const snippetWantsPlayRef = useRef(false);
  const snippetRetryRef = useRef<(() => void) | null>(null);
  const snippetFailureRef = useRef<((kind?: StreamResolveFailure) => void) | null>(null);
  const snippetNeedsResolveRef = useRef(false);

  const [snippetTrack, setSnippetTrack] = useState<Track | null>(null);
  const [isSnippetPlaying, setIsSnippetPlaying] = useState<boolean>(false);
  const [snippetProgress, setSnippetProgress] = useState<number>(0);

  useEffect(() => {
    snippetTrackRef.current = snippetTrack;
  }, [snippetTrack]);

  const youtubeDisabled = useYouTubeAvailability();

  // Stop snippet helper (closes modal and resets resources)
  const stopSnippet = useCallback(() => {
    streamRequestIdRef.current++;
    snippetWantsPlayRef.current = false;
    snippetLoadVersionRef.current++;
    snippetRetryRef.current = null;
    snippetFailureRef.current = null;
    snippetTrackRef.current = null;
    streamAbortRef.current?.abort();
    streamAbortRef.current = null;
    if (snippetHlsRef.current) {
      snippetHlsRef.current.destroy();
      snippetHlsRef.current = null;
    }
    const audio = snippetAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
    }
    setIsSnippetPlaying(false);
    setSnippetTrack(null);
    setSnippetProgress(0);
  }, []);

  useEffect(() => {
    if (youtubeDisabled && isYouTubeItemDisabled(snippetTrackRef.current)) stopSnippet();
  }, [youtubeDisabled, stopSnippet]);

  // Initialize snippet audio element
  useEffect(() => {
    const snippetAudio = new Audio();
    snippetAudio.preload = 'auto';
    snippetAudio.volume = isMuted ? 0 : volume;
    snippetAudioRef.current = snippetAudio;

    const handleSnippetEnded = () => {
      stopSnippet();
    };

    const handleSnippetPause = () => {
      if (snippetAudio.paused) setIsSnippetPlaying(false);
    };

    const handleSnippetPlay = () => {
      if (snippetWantsPlayRef.current && snippetTrackRef.current && !snippetAudio.paused)
        setIsSnippetPlaying(true);
    };

    const handleSnippetError = () => {
      if (!snippetAudio.error) return;
      PlaybackLogger.warn('[Snippet:Playback] Media source failed', {
        trackId: snippetTrackRef.current?.id,
        code: snippetAudio.error.code,
      });
      snippetFailureRef.current?.('network');
      setIsSnippetPlaying(false);
    };

    snippetAudio.addEventListener('ended', handleSnippetEnded);
    snippetAudio.addEventListener('pause', handleSnippetPause);
    snippetAudio.addEventListener('play', handleSnippetPlay);
    snippetAudio.addEventListener('error', handleSnippetError);

    return () => {
      snippetWantsPlayRef.current = false;
      streamAbortRef.current?.abort();
      streamAbortRef.current = null;
      snippetLoadVersionRef.current++;
      snippetRetryRef.current = null;
      snippetFailureRef.current = null;
      if (snippetHlsRef.current) {
        snippetHlsRef.current.destroy();
        snippetHlsRef.current = null;
      }
      snippetAudio.removeEventListener('ended', handleSnippetEnded);
      snippetAudio.removeEventListener('pause', handleSnippetPause);
      snippetAudio.removeEventListener('play', handleSnippetPlay);
      snippetAudio.removeEventListener('error', handleSnippetError);
      snippetAudio.pause();
      snippetAudio.removeAttribute('src');
    };
  }, [stopSnippet]);

  // Sync volume with snippetAudio element
  useEffect(() => {
    if (snippetAudioRef.current) {
      snippetAudioRef.current.volume = isMuted ? 0 : volume;
    }
  }, [volume, isMuted]);

  // Snippet progress animation loop (Active ONLY while snippet is playing)
  useEffect(() => {
    if (!isSnippetPlaying) return;

    let animFrame: number;
    const tick = () => {
      const snippetAudio = snippetAudioRef.current;
      if (snippetAudio && !snippetAudio.paused) {
        const current = snippetAudio.currentTime;
        const start = snippetStartRef.current;
        const end = snippetEndRef.current;

        const progressState = getSnippetProgressState(current, start, end, SNIPPET_DURATION);

        // If audio has not sought to start yet (e.g. at 0 before metadata load), don't trigger end
        if (progressState.isSeeking) {
          animFrame = requestAnimationFrame(tick);
          return;
        }

        if (progressState.isFinished) {
          stopSnippet();
        } else {
          setSnippetProgress(progressState.progress);
        }
      }
      animFrame = requestAnimationFrame(tick);
    };

    animFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animFrame);
  }, [isSnippetPlaying, stopSnippet]);

  // Toggle snippet play/pause without closing the modal
  const toggleSnippetPlay = useCallback(() => {
    const snippetAudio = snippetAudioRef.current;
    if (!snippetAudio || !snippetTrack || isYouTubeItemDisabled(snippetTrack)) return;

    if (isSnippetPlaying || snippetWantsPlayRef.current) {
      snippetWantsPlayRef.current = false;
      snippetAudio.pause();
      setIsSnippetPlaying(false);
    } else {
      onPauseMainAudio();
      snippetWantsPlayRef.current = true;
      if (snippetNeedsResolveRef.current || snippetAudio.readyState < 2 || snippetAudio.error) {
        snippetRetryRef.current?.();
        return;
      }
      const start = snippetStartRef.current;
      const end = snippetEndRef.current;
      if (snippetAudio.currentTime < start || snippetAudio.currentTime >= end) {
        snippetAudio.currentTime = start;
      }
      const requestId = streamRequestIdRef.current;
      const version = snippetLoadVersionRef.current;
      const isCurrentResume = () =>
        requestId === streamRequestIdRef.current &&
        version === snippetLoadVersionRef.current &&
        snippetWantsPlayRef.current &&
        !streamAbortRef.current?.signal.aborted;
      snippetAudio
        .play()
        .then(() => {
          if (isCurrentResume()) setIsSnippetPlaying(true);
        })
        .catch((error) => {
          if (isCurrentResume() && error?.name !== 'AbortError') snippetFailureRef.current?.();
        });
    }
  }, [snippetTrack, isSnippetPlaying, onPauseMainAudio]);

  // Seek within 10-second snippet (0 to 1 fraction)
  const seekSnippet = useCallback(
    (fraction: number) => {
      const snippetAudio = snippetAudioRef.current;
      if (!snippetAudio || !snippetTrack) return;
      const clamped = Math.max(0, Math.min(1, fraction));
      const start = snippetStartRef.current;
      snippetAudio.currentTime = start + clamped * SNIPPET_DURATION;
      setSnippetProgress(clamped);
    },
    [snippetTrack],
  );

  // 10-Second Midpoint Snippet Preview (Instant Modal + Fast Playback)
  const previewSnippet = useCallback(
    (track: Track) => {
      if (isYouTubeItemDisabled(track)) return;
      const snippetAudio = snippetAudioRef.current;
      if (!snippetAudio) return;

      streamAbortRef.current?.abort();
      snippetWantsPlayRef.current = false;
      snippetHlsRef.current?.destroy();
      snippetHlsRef.current = null;
      snippetAudio.pause();
      snippetAudio.removeAttribute('src');
      snippetAudio.load();
      onPauseMainAudio();
      const currentRequestId = ++streamRequestIdRef.current;
      const streamController = new AbortController();
      streamAbortRef.current = streamController;
      snippetTrackRef.current = track;
      snippetWantsPlayRef.current = true;
      snippetNeedsResolveRef.current = false;
      setSnippetTrack(track);
      setSnippetProgress(0);
      setIsSnippetPlaying(true);
      const trackDuration = track.duration || DEFAULT_TRACK_DURATION;
      const source = detectTrackSource(track);
      const fullStart = Math.max(0, Math.floor((trackDuration - SNIPPET_DURATION) / 2));
      snippetStartRef.current = fullStart;
      snippetEndRef.current = fullStart + SNIPPET_DURATION;
      let resolving = false,
        recoveryAttempt = 0;
      const isCurrent = () =>
        !streamController.signal.aborted &&
        currentRequestId === streamRequestIdRef.current &&
        snippetTrackRef.current === track &&
        snippetWantsPlayRef.current;
      const unavailable = (kind?: StreamResolveFailure) => {
        if (!isCurrent()) return;
        snippetNeedsResolveRef.current = true;
        snippetWantsPlayRef.current = false;
        setIsSnippetPlaying(false);
        PlaybackLogger.warn('[Snippet:Playback] Preview source unavailable', {
          trackId: track.id,
          source,
          kind,
          attempt: recoveryAttempt,
        });
        emitToast(
          'Не удалось запустить сниппет. Нажмите воспроизведение, чтобы повторить.',
          'warning',
          5000,
        );
      };
      const load = (url: string, start: number) => {
        if (!isCurrent()) return;
        const version = ++snippetLoadVersionRef.current;
        const owner: AudioLoadOwner = {
          signal: streamController.signal,
          isCurrent: () => isCurrent() && version === snippetLoadVersionRef.current,
          onFailure: (kind) => {
            if (!owner.isCurrent() || resolving) return;
            resolvedStreamCache.current.delete(String(track.id));
            snippetNeedsResolveRef.current = true;
            if (recoveryAttempt >= 1 || kind === 'rate-limit') {
              unavailable(kind);
              return;
            }
            recoveryAttempt++;
            PlaybackLogger.info('[Snippet:Recovery] Refreshing the same recording', {
              trackId: track.id,
              source,
              kind,
            });
            void resolveFull(true);
          },
        };
        snippetFailureRef.current = owner.onFailure;
        loadStreamIntoAudio(snippetAudio, snippetHlsRef, url, start, true, track.id, true, owner);
      };
      const resolveFull = async (alternate = false) => {
        if (resolving || !isCurrent()) return;
        resolving = true;
        snippetNeedsResolveRef.current = true;
        try {
          const url = await resolvePlayerStream(
            { ...track, source },
            {
              forceRefresh: true,
              allowSessionRecovery: true,
              preferAlternateFormat: alternate && source === 'soundcloud',
            },
            streamController.signal,
            (item, options, signal) => platformBridge.getFullStreamUrl(item, options, signal),
          );
          if (!isCurrent()) return;
          if (!isPlayableDirectAudioUrl(url)) {
            unavailable();
            return;
          }
          resolvedStreamCache.current.set(String(track.id), { url, timestamp: Date.now() });
          snippetStartRef.current = fullStart;
          snippetEndRef.current = fullStart + SNIPPET_DURATION;
          const position = snippetAudio.currentTime;
          const seek =
            position >= fullStart && position < snippetEndRef.current ? position : fullStart;
          snippetNeedsResolveRef.current = false;
          resolving = false;
          load(url, seek);
        } catch (error) {
          if (isCurrent()) unavailable();
        } finally {
          resolving = false;
        }
      };
      snippetRetryRef.current = () => {
        if (!isCurrent()) return;
        recoveryAttempt = 0;
        setIsSnippetPlaying(true);
        void resolveFull();
      };
      const cached = resolvedStreamCache.current.get(String(track.id));
      const cachedUrl =
        cached &&
        Date.now() - cached.timestamp < STREAM_URL_MAX_AGE_MS &&
        isPlayableDirectAudioUrl(cached.url)
          ? cached.url
          : '';
      // SoundCloud can reject signed HLS links before the generic seven-minute cache expires.
      // A fresh same-recording lookup avoids replaying that rejected manifest on every click.
      if (source !== 'soundcloud' && cachedUrl) load(cachedUrl, fullStart);
      else void resolveFull();
    },
    [onPauseMainAudio, resolvedStreamCache, streamRequestIdRef, loadStreamIntoAudio],
  );

  return {
    snippetTrack,
    isSnippetPlaying,
    snippetProgress,
    snippetAudioRef,
    snippetHlsRef,
    stopSnippet,
    previewSnippet,
    toggleSnippetPlay,
    seekSnippet,
  };
}
