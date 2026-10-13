import { useCallback, useEffect, useRef, useState } from 'react';
import type { Track } from '../types';
import { platformBridge } from '../bridge/platformBridge';
import { emitToast } from '../context/ToastContext';
import { useYouTubeAvailability } from './useYouTubeAvailability';
import {
  attachHlsVideo,
  isHlsVideoUrl,
  watchVideoStartup,
  watchVideoProgress,
  syncVideoPlayback,
} from '../utils/videoStreamPlayback';
import { emitYouTubeAccessIssue } from '../utils/youtubeAccessHint';
import { getVideoPlaybackError, type VideoPlaybackError } from '../utils/videoPlaybackError';

type Options = {
  currentTrack: Track | null;
  currentTime: number;
  isPlaying: boolean;
  isOpen: boolean;
  viewMode: 'lyrics' | 'guitar';
  isMobileLayout: boolean;
};

export function useLyricsVideo({
  currentTrack,
  currentTime,
  isPlaying,
  isOpen,
  viewMode,
  isMobileLayout,
}: Options) {
  // Video Clip State
  const [activeVideoId, setActiveVideoId] = useState<string | null>(null);
  const youtubeDisabled = useYouTubeAvailability();
  useEffect(() => {
    if (youtubeDisabled) setShowVideo(false);
  }, [youtubeDisabled]);
  const [clipSearchStatus, setClipSearchStatus] = useState<
    'idle' | 'searching' | 'found' | 'missing'
  >('idle');
  const [videoStreamUrl, setVideoStreamUrl] = useState<string | null>(null);
  const [clipPlaybackError, setClipPlaybackError] = useState<VideoPlaybackError | null>(null);
  const [videoResolveAttempt, setVideoResolveAttempt] = useState(0);
  const [isResolvingVideoStream, setIsResolvingVideoStream] = useState(false);
  const [showVideo, setShowVideo] = useState<boolean>(true);
  const videoIframeRef = useRef<HTMLIFrameElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
  const iframePlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSyncedTimeRef = useRef<number>(currentTime);

  const videoRecoveryRef = useRef(0);
  const videoFreshRequestRef = useRef(false);
  const clipPlaybackStateRef = useRef({ time: currentTime, playing: isPlaying, enabled: false });
  clipPlaybackStateRef.current = {
    time: currentTime,
    playing: isPlaying,
    enabled: isOpen && viewMode === 'lyrics' && showVideo,
  };
  const clipArtist =
    typeof currentTrack?.artist === 'object'
      ? currentTrack.artist.name
      : String(currentTrack?.artist || '');
  const clipTitle = (currentTrack?.title || '').replace(/\([^)]*\)|\[[^\]]*\]/g, '').trim();

  useEffect(() => {
    videoRecoveryRef.current = 0;
  }, [isOpen, activeVideoId]);

  const retryVideoStream = useCallback(() => {
    if (videoRecoveryRef.current >= 1) return false;
    videoRecoveryRef.current++;
    videoFreshRequestRef.current = true;
    setVideoStreamUrl(null);
    setIsResolvingVideoStream(true);
    setVideoResolveAttempt((attempt) => attempt + 1);
    return true;
  }, []);

  const handleDirectVideoFailure = useCallback(() => {
    if (retryVideoStream()) return;
    // The direct route failed twice. The embedded player gets one chance, then shows the cover.
    setVideoStreamUrl(null);
    setIsResolvingVideoStream(false);
  }, [retryVideoStream]);

  useEffect(
    () =>
      window.electronAPI?.onYouTubeSessionReset?.(() => {
        videoRecoveryRef.current = 0;
        videoFreshRequestRef.current = true;
        setClipPlaybackError(null);
        setVideoStreamUrl(null);
        setVideoResolveAttempt((attempt) => attempt + 1);
      }),
    [],
  );

  useEffect(() => {
    const video = videoElementRef.current;
    if (
      !isOpen ||
      viewMode !== 'lyrics' ||
      !showVideo ||
      isResolvingVideoStream ||
      !video ||
      !videoStreamUrl
    )
      return;
    let active = true;
    const log = (event: string) => {
      const message = '[Clip:Playback] clip=' + activeVideoId + ' ' + event;
      window.electronAPI?.logPlaybackEvent?.('info', message);
    };
    const fail = (reason: string) => {
      if (!active) return;
      active = false;
      log('failed ' + reason);
      handleDirectVideoFailure();
    };
    log('attach type=' + (isHlsVideoUrl(videoStreamUrl) ? 'hls' : 'progressive'));
    const stopProgress = watchVideoProgress(video, () => clipPlaybackStateRef.current, fail, log);
    const detach = isHlsVideoUrl(videoStreamUrl)
      ? attachHlsVideo(video, videoStreamUrl, () => fail('hls-startup'))
      : watchVideoStartup(video, () => fail('startup'), videoStreamUrl);
    return () => {
      active = false;
      stopProgress();
      detach();
    };
  }, [
    isOpen,
    showVideo,
    videoStreamUrl,
    isResolvingVideoStream,
    activeVideoId,
    viewMode,
    handleDirectVideoFailure,
    youtubeDisabled,
  ]);

  const sendVideoCommand = useCallback((func: string, args: any[] = []) => {
    try {
      if (videoIframeRef.current?.contentWindow) {
        videoIframeRef.current.contentWindow.postMessage(
          JSON.stringify({ event: 'command', func, args }),
          '*',
        );
      }
    } catch {}
  }, []);

  // Fetch direct video MP4 stream when activeVideoId changes
  useEffect(() => {
    let isCancelled = false;
    if (youtubeDisabled || !isOpen || !showVideo || viewMode !== 'lyrics' || !activeVideoId) {
      setVideoStreamUrl(null);
      setIsResolvingVideoStream(false);
      return;
    }

    setVideoStreamUrl(null);
    setIsResolvingVideoStream(true);
    if (platformBridge.getVideoStream) {
      platformBridge
        .getVideoStream(activeVideoId, { forceRefresh: videoFreshRequestRef.current })
        .then((url) => {
          if (!isCancelled) {
            if (!url && retryVideoStream()) return;
            setVideoStreamUrl(url || null);
            setIsResolvingVideoStream(false);
          }
        })
        .catch((err) => {
          console.warn('[LyricsModal] Direct video resolution notice:', err);
          if (!isCancelled) {
            setIsResolvingVideoStream(false);
            // A verified age gate cannot be fixed by retrying an anonymous iframe.
            const access = getVideoPlaybackError(err);
            if (access !== 'unavailable') {
              setClipPlaybackError(access);
              setShowVideo(false);
              emitYouTubeAccessIssue({
                reason: access,
                source: 'clip',
                trackId: currentTrack?.id || '',
              });
            } else {
              retryVideoStream();
            }
          }
        });
      videoFreshRequestRef.current = false;
    }

    return () => {
      isCancelled = true;
    };
  }, [
    isOpen,
    showVideo,
    viewMode,
    activeVideoId,
    currentTrack?.id,
    videoResolveAttempt,
    retryVideoStream,
    youtubeDisabled,
  ]);

  // Sync native video and iframe play / pause with audio state
  useEffect(() => {
    if (!isOpen || viewMode !== 'lyrics' || !showVideo) {
      videoElementRef.current?.pause();
      sendVideoCommand('pauseVideo');
      return;
    }
    if (videoElementRef.current) {
      if (isPlaying) {
        videoElementRef.current.play().catch(() => {});
      } else {
        videoElementRef.current.pause();
      }
    }
    if (activeVideoId && !videoStreamUrl && !isResolvingVideoStream) {
      if (isPlaying) {
        sendVideoCommand('playVideo');
        sendVideoCommand('mute');
      } else {
        sendVideoCommand('pauseVideo');
      }
    }
  }, [
    isOpen,
    viewMode,
    isPlaying,
    showVideo,
    activeVideoId,
    videoStreamUrl,
    isResolvingVideoStream,
    sendVideoCommand,
  ]);

  // Sync video seek with audio currentTime
  useEffect(() => {
    if (!isOpen || viewMode !== 'lyrics' || !showVideo) return;
    if (videoElementRef.current) {
      syncVideoPlayback(videoElementRef.current, currentTime, isPlaying);
    }
    if (activeVideoId && !videoStreamUrl && !isResolvingVideoStream) {
      if (Math.abs(currentTime - lastSyncedTimeRef.current) > 1.5) {
        sendVideoCommand('seekTo', [currentTime, true]);
        sendVideoCommand('mute');
      }
    }
    lastSyncedTimeRef.current = currentTime;
  }, [
    isOpen,
    viewMode,
    currentTime,
    isPlaying,
    showVideo,
    activeVideoId,
    videoStreamUrl,
    isResolvingVideoStream,
    sendVideoCommand,
  ]);

  // A loaded iframe can still display YouTube's own error page. Listen for player
  // errors and return to the cover instead of leaving that error on screen.
  useEffect(() => {
    const handleYouTubeMessage = (e: MessageEvent) => {
      if (e.source !== videoIframeRef.current?.contentWindow) return;
      try {
        if (typeof e.data !== 'string') return;
        const parsed = JSON.parse(e.data);
        if (parsed.event === 'onReady') {
          sendVideoCommand('addEventListener', ['onError']);
          sendVideoCommand('addEventListener', ['onStateChange']);
          const playback = clipPlaybackStateRef.current;
          sendVideoCommand('mute');
          sendVideoCommand('seekTo', [playback.time, true]);
          sendVideoCommand(playback.enabled && playback.playing ? 'playVideo' : 'pauseVideo');
        }
        if (
          parsed.event === 'onStateChange' &&
          [1, 2, 5].includes(Number(parsed.info ?? parsed.data))
        ) {
          if (iframePlaybackTimerRef.current) clearTimeout(iframePlaybackTimerRef.current);
          iframePlaybackTimerRef.current = null;
        }
        if (parsed.event === 'onError') {
          console.warn('[LyricsModal] YouTube video playback failed:', parsed.info ?? parsed.data);
          if (iframePlaybackTimerRef.current) clearTimeout(iframePlaybackTimerRef.current);
          iframePlaybackTimerRef.current = null;
          setShowVideo(false);
          setClipPlaybackError('unavailable');
        }
      } catch {}
    };
    window.addEventListener('message', handleYouTubeMessage);
    return () => window.removeEventListener('message', handleYouTubeMessage);
  }, [sendVideoCommand]);

  useEffect(() => {
    if (
      !isOpen ||
      viewMode !== 'lyrics' ||
      !showVideo ||
      !activeVideoId ||
      isResolvingVideoStream ||
      videoStreamUrl
    )
      return;
    iframePlaybackTimerRef.current = setTimeout(() => {
      console.warn('[LyricsModal] YouTube video did not become playable, switching to cover');
      setShowVideo(false);
      setClipPlaybackError('unavailable');
    }, 15000);
    return () => {
      if (iframePlaybackTimerRef.current) clearTimeout(iframePlaybackTimerRef.current);
      iframePlaybackTimerRef.current = null;
    };
  }, [isOpen, viewMode, showVideo, activeVideoId, isResolvingVideoStream, videoStreamUrl]);

  const [isClipSearchEnabled, setIsClipSearchEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soso_find_clips') !== 'false';
    } catch {
      return true;
    }
  });

  useEffect(() => {
    const handleSettingsChange = (e: any) => {
      if (e?.detail?.key === 'soso_find_clips') {
        const val = e.detail.value !== false && e.detail.value !== 'false';
        setIsClipSearchEnabled(val);
        if (!val) {
          setShowVideo(false);
          setActiveVideoId(null);
        }
      }
    };
    window.addEventListener('soso:settings-changed' as any, handleSettingsChange);
    return () => window.removeEventListener('soso:settings-changed' as any, handleSettingsChange);
  }, []);

  // Video resolution: direct YouTube track or search for official video clip
  useEffect(() => {
    let isCancelled = false;
    if (!isOpen || !currentTrack || !isClipSearchEnabled) {
      setActiveVideoId(null);
      setShowVideo(false);
      setClipSearchStatus('idle');
      setClipPlaybackError(null);
      return;
    }

    setActiveVideoId(null);
    setVideoStreamUrl(null);
    setShowVideo(false);
    setClipSearchStatus('searching');
    setClipPlaybackError(null);

    const resolveVideo = async () => {
      try {
        const rawArtist = clipArtist,
          cleanTitle = clipTitle;

        const storedApiKey = localStorage.getItem('soso_youtube_api_key') || undefined;
        // 1. Dedicated search for authentic official music video (filters out Topic/audio releases, covers, tutorials)
        const officialVid = await platformBridge.getOfficialVideoClip(
          rawArtist,
          cleanTitle,
          storedApiKey,
        );
        if (isCancelled) return;

        if (officialVid && /^[a-zA-Z0-9_-]{11}$/.test(officialVid)) {
          setIsResolvingVideoStream(!isMobileLayout);
          setActiveVideoId(officialVid);
          setShowVideo(!isMobileLayout);
          setClipSearchStatus('found');
          return;
        }
      } catch (err) {
        console.warn('[LyricsModal] Failed to search for video clip:', err);
      }

      if (!isCancelled) {
        setActiveVideoId(null);
        setShowVideo(false);
        setClipSearchStatus('missing');
      }
    };

    resolveVideo();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentTrack?.id, clipArtist, clipTitle, isClipSearchEnabled, isMobileLayout]);

  const handleVideoToggle = () => {
    if (youtubeDisabled) return;
    if (activeVideoId && clipPlaybackError && clipPlaybackError !== 'unavailable') {
      emitYouTubeAccessIssue({
        reason: clipPlaybackError,
        source: 'clip',
        trackId: currentTrack?.id || '',
      });
      if (typeof window === 'undefined' || !window.electronAPI?.connectYouTubeAccount) {
        emitToast(
          clipPlaybackError === 'age-restricted'
            ? 'YouTube требует подтверждения возраста для этого клипа.'
            : clipPlaybackError === 'verification-required'
              ? 'YouTube требует проверки на бота для этого клипа.'
              : 'YouTube требует входа для этого клипа.',
          'info',
        );
      }
      return;
    }
    if (!activeVideoId) {
      emitToast(
        clipSearchStatus === 'searching'
          ? 'Ищем официальный клип…'
          : 'Официальный клип не найден. Показываем обложку.',
        'info',
      );
      return;
    }
    if (clipPlaybackError) {
      videoRecoveryRef.current = 0;
      videoFreshRequestRef.current = true;
      setClipPlaybackError(null);
      setVideoResolveAttempt((attempt) => attempt + 1);
      setShowVideo(true);
    } else {
      setShowVideo((prev) => !prev);
    }
  };

  return {
    state: {
      activeVideoId,
      clipSearchStatus,
      videoStreamUrl,
      clipPlaybackError,
      isResolvingVideoStream,
      showVideo,
      isClipSearchEnabled,
      youtubeDisabled,
    },
    controls: {
      sendVideoCommand,
      handleDirectVideoFailure,
      setShowVideo,
      setClipPlaybackError,
      handleVideoToggle,
    },
    elements: { videoIframeRef, videoElementRef },
  };
}
