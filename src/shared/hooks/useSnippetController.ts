import { useYouTubeAvailability } from './useYouTubeAvailability';
import { isYouTubeItemDisabled } from '../services/youtubeAvailability.ts';
import { useState, useRef, useEffect, useCallback } from 'react';
import Hls from 'hls.js';
import { Track } from '../types';
import { detectTrackSource } from '../utils/formatters';
import { platformBridge } from '../bridge/platformBridge';
import { isPlayableDirectAudioUrl } from '../utils/audioUrlValidator';
import { getSnippetProgressState } from '../utils/snippetProgress';
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
  const snippetHlsRef = useRef<Hls | null>(null);
  const snippetTrackRef = useRef<Track | null>(null);
  const snippetStartRef = useRef<number>(10);
  const snippetEndRef = useRef<number>(20);

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
      setIsSnippetPlaying(false);
    };

    const handleSnippetPlay = () => {
      setIsSnippetPlaying(true);
    };

    const handleSnippetError = (e: any) => {
      console.warn('Snippet audio loading notice:', e);
      setIsSnippetPlaying(false);
    };

    snippetAudio.addEventListener('ended', handleSnippetEnded);
    snippetAudio.addEventListener('pause', handleSnippetPause);
    snippetAudio.addEventListener('play', handleSnippetPlay);
    snippetAudio.addEventListener('error', handleSnippetError);

    return () => {
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

    if (isSnippetPlaying) {
      snippetAudio.pause();
      setIsSnippetPlaying(false);
    } else {
      onPauseMainAudio();
      const start = snippetStartRef.current;
      const end = snippetEndRef.current;
      if (snippetAudio.currentTime < start || snippetAudio.currentTime >= end) {
        snippetAudio.currentTime = start;
      }
      snippetAudio
        .play()
        .then(() => {
          setIsSnippetPlaying(true);
        })
        .catch(console.error);
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

      const currentRequestId = ++streamRequestIdRef.current;

      // Immediately pause main playback if playing
      onPauseMainAudio();

      // Open snippet modal INSTANTLY (0ms latency!)
      setSnippetTrack(track);
      setSnippetProgress(0);
      setIsSnippetPlaying(true);

      const trackDuration = track.duration || DEFAULT_TRACK_DURATION;
      const cachedStream = resolvedStreamCache.current.get(String(track.id));
      const hasFullStream = !!(
        cachedStream && Date.now() - cachedStream.timestamp < STREAM_URL_MAX_AGE_MS
      );

      // Preview files are only 30s long — clamp seek to fit within them
      // Full streams can be seeked to the track midpoint
      let startPoint: number;
      if (hasFullStream) {
        startPoint = Math.max(5, Math.floor(trackDuration / 2) - 5);
      } else {
        // For 30s preview: place snippet at second 10-20 (safe zone)
        startPoint = Math.min(20, Math.max(5, Math.floor(30 / 2) - 5));
      }
      snippetStartRef.current = startPoint;
      snippetEndRef.current = startPoint + SNIPPET_DURATION;

      try {
        snippetAudio.pause();
        snippetAudio.currentTime = startPoint;
      } catch (e) {}

      const directSrc =
        (hasFullStream && cachedStream?.url) ||
        (isPlayableDirectAudioUrl(track.preview) ? track.preview : '');
      if (directSrc) {
        loadStreamIntoAudio(snippetAudio, snippetHlsRef, directSrc, startPoint, true, track.id);
      }

      // Resolve full stream if not yet cached
      if (!hasFullStream) {
        platformBridge
          .getFullStreamUrl({
            ...track,
            title: track.title,
            artist:
              typeof track.artist === 'object' && track.artist
                ? track.artist
                : { name: String(track.artist || '') },
            id: track.id,
            preview: track.preview,
            duration: track.duration,
            source: detectTrackSource(track),
          })
          .then((fullStreamUrl) => {
            if (currentRequestId !== streamRequestIdRef.current) return;
            if (fullStreamUrl) {
              resolvedStreamCache.current.set(String(track.id), {
                url: fullStreamUrl,
                timestamp: Date.now(),
              });
              if (
                snippetAudioRef.current &&
                snippetTrackRef.current &&
                String(snippetTrackRef.current.id) === String(track.id)
              ) {
                const fullStartPoint = Math.max(5, Math.floor(trackDuration / 2) - 5);
                snippetStartRef.current = fullStartPoint;
                snippetEndRef.current = fullStartPoint + SNIPPET_DURATION;
                loadStreamIntoAudio(
                  snippetAudioRef.current,
                  snippetHlsRef,
                  fullStreamUrl,
                  fullStartPoint,
                  true,
                  track.id,
                );
              }
            }
          })
          .catch(console.warn);
      }
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
