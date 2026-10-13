import { useState, useRef, useEffect, useCallback } from 'react';
import { trackVolumeNormalization } from '../services/trackVolumeNormalization';
import { logger } from '../utils/logger';
import {
  applyAudioVolume,
  clampAudioVolume,
  isAudioFading,
  setAudioFadeVolume,
  resetAudioFadeVolume,
} from '../utils/audioVolume';
import { calculateFadeInVolume, calculateFadeOutVolume } from '../utils/crossfade';

interface UseAudioSettingsProps {
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  snippetAudioRef?: React.MutableRefObject<HTMLAudioElement | null>;
}

export function useAudioSettings({ audioRef, snippetAudioRef }: UseAudioSettingsProps) {
  // Volume & Mute states
  const [volume, setVolumeState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('soso_volume');
      return saved !== null ? clampAudioVolume(Number(saved)) : 0.8;
    } catch {
      return 0.8;
    }
  });

  const [isMuted, setIsMuted] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('soso_is_muted');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const [previousVolume, setPreviousVolume] = useState<number>(0.8);

  // Audio enhancement states
  const [isVolumeNormalizationEnabled, setIsVolumeNormalizationEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('soso_volume_normalization');
      return saved === 'true';
    } catch {
      return false;
    }
  });

  const [crossfadeDuration, setCrossfadeDurationState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem('soso_crossfade_duration');
      return saved !== null ? parseInt(saved, 10) : 3;
    } catch {
      return 3;
    }
  });

  const [isScrobblingEnabled, setIsScrobblingEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('soso_wave_scrobbling');
      return saved !== 'false';
    } catch {
      return true;
    }
  });

  // Mutable refs to eliminate stale closures
  const volumeRef = useRef<number>(volume);
  const isMutedRef = useRef<boolean>(isMuted);
  const isVolumeNormalizationRef = useRef<boolean>(isVolumeNormalizationEnabled);
  const crossfadeDurationRef = useRef<number>(crossfadeDuration);
  const isScrobblingRef = useRef<boolean>(isScrobblingEnabled);
  const isCrossfadingRef = useRef<boolean>(false);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    trackVolumeNormalization().setEnabled(isVolumeNormalizationEnabled);
  }, [isVolumeNormalizationEnabled]);

  // Fader intervals
  const fadeInIntervalRef = useRef<any>(null);
  const fadeOutIntervalRef = useRef<any>(null);
  const fadingAudioRef = useRef<HTMLAudioElement | null>(null);

  const cancelFade = useCallback(() => {
    if (fadingAudioRef.current) resetAudioFadeVolume(fadingAudioRef.current);
    fadingAudioRef.current = null;
    if (fadeInIntervalRef.current !== null) {
      clearInterval(fadeInIntervalRef.current);
      fadeInIntervalRef.current = null;
    }
    if (fadeOutIntervalRef.current !== null) {
      clearInterval(fadeOutIntervalRef.current);
      fadeOutIntervalRef.current = null;
    }
  }, []);

  const fadeIn = useCallback(
    (durationSeconds: number) => {
      cancelFade();
      const audio = audioRef.current;
      if (!audio) return;

      const targetVol = isMutedRef.current ? 0 : volumeRef.current;
      if (targetVol <= 0 || durationSeconds <= 0) {
        audio.volume = targetVol;
        return;
      }

      // If document is in background/hidden, immediately apply target volume to avoid any delay/silence
      if (typeof document !== 'undefined' && document.hidden) {
        audio.volume = targetVol;
        return;
      }

      fadingAudioRef.current = audio;
      setAudioFadeVolume(audio, targetVol, 0);
      const startTime = performance.now();
      const durationMs = Math.max(100, durationSeconds * 1000);

      fadeInIntervalRef.current = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const base = isMutedRef.current ? 0 : volumeRef.current;
        const factor = calculateFadeInVolume(1, progress);
        if (audioRef.current && !isMutedRef.current) {
          setAudioFadeVolume(audioRef.current, base, factor);
        }

        if (progress >= 1) {
          if (audioRef.current && !isMutedRef.current) {
            setAudioFadeVolume(audioRef.current, isMutedRef.current ? 0 : volumeRef.current, 1);
            fadingAudioRef.current = null;
          }
          if (fadeInIntervalRef.current !== null) {
            clearInterval(fadeInIntervalRef.current);
            fadeInIntervalRef.current = null;
          }
        }
      }, 25);
    },
    [audioRef, cancelFade],
  );

  const fadeOut = useCallback(
    (durationSeconds: number, onComplete?: () => void) => {
      cancelFade();
      const audio = audioRef.current;
      if (!audio) {
        onComplete?.();
        return;
      }

      const startVol = audio.volume;
      if (startVol <= 0 || durationSeconds <= 0) {
        onComplete?.();
        return;
      }

      // If document is hidden, finish immediately
      if (typeof document !== 'undefined' && document.hidden) {
        onComplete?.();
        return;
      }

      fadingAudioRef.current = audio;
      const startTime = performance.now();
      const durationMs = Math.max(100, durationSeconds * 1000);

      fadeOutIntervalRef.current = setInterval(() => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(1, elapsed / durationMs);
        const base = startVol;
        const factor = calculateFadeOutVolume(1, progress);
        if (audioRef.current && !isMutedRef.current) {
          setAudioFadeVolume(audioRef.current, base, factor);
        }

        if (progress >= 1) {
          if (audioRef.current && !isMutedRef.current) {
            setAudioFadeVolume(audioRef.current, 0, 1);
            fadingAudioRef.current = null;
          }
          if (fadeOutIntervalRef.current !== null) {
            clearInterval(fadeOutIntervalRef.current);
            fadeOutIntervalRef.current = null;
          }
          onComplete?.();
        }
      }, 25);
    },
    [audioRef, cancelFade],
  );

  useEffect(() => cancelFade, [cancelFade]);

  // Set volume
  const setVolume = useCallback(
    (val: number) => {
      const clamped = clampAudioVolume(val, volumeRef.current);
      cancelFade();
      setVolumeState(clamped);
      volumeRef.current = clamped;
      const nextMuted = clamped > 0 ? false : isMutedRef.current;
      if (nextMuted !== isMutedRef.current) {
        isMutedRef.current = nextMuted;
        setIsMuted(false);
        try {
          localStorage.setItem('soso_is_muted', 'false');
        } catch (e) {
          logger.debug('[useAudioSettings] Failed to persist mute state:', e);
        }
      }
      applyAudioVolume(audioRef.current, clamped, nextMuted);
      applyAudioVolume(snippetAudioRef?.current ?? null, clamped, nextMuted);
    },
    [audioRef, snippetAudioRef, cancelFade],
  );

  // Toggle mute
  const toggleMute = useCallback(() => {
    cancelFade();
    setIsMuted((prev) => {
      const next = !prev;
      isMutedRef.current = next;
      try {
        localStorage.setItem('soso_is_muted', next ? 'true' : 'false');
      } catch (e) {
        logger.debug('[useAudioSettings] Failed to persist mute state:', e);
      }
      applyAudioVolume(audioRef.current, volumeRef.current, next);
      applyAudioVolume(snippetAudioRef?.current ?? null, volumeRef.current, next);
      if (next) {
        setPreviousVolume(volumeRef.current || 0.8);
      }
      return next;
    });
  }, [audioRef, snippetAudioRef, cancelFade]);

  const toggleVolumeNormalization = useCallback(() => {
    setIsVolumeNormalizationEnabled((prev) => {
      const next = !prev;
      isVolumeNormalizationRef.current = next;
      try {
        localStorage.setItem('soso_volume_normalization', next ? 'true' : 'false');
      } catch (e) {
        logger.debug('[useAudioSettings] Failed to persist volume normalization setting:', e);
      }
      return next;
    });
  }, []);

  const setCrossfadeDuration = useCallback((sec: number) => {
    const clamped = Math.max(0, Math.min(12, sec));
    setCrossfadeDurationState(clamped);
    crossfadeDurationRef.current = clamped;
    try {
      localStorage.setItem('soso_crossfade_duration', String(clamped));
    } catch (e) {
      logger.debug('[useAudioSettings] Failed to persist crossfade setting:', e);
    }
  }, []);

  const toggleScrobbling = useCallback(() => {
    setIsScrobblingEnabled((prev) => {
      const next = !prev;
      isScrobblingRef.current = next;
      try {
        localStorage.setItem('soso_wave_scrobbling', next ? 'true' : 'false');
      } catch (e) {
        logger.debug('[useAudioSettings] Failed to persist scrobbling setting:', e);
      }
      return next;
    });
  }, []);

  // Synchronize volume across HTMLAudioElement and Snippet Audio
  useEffect(() => {
    applyAudioVolume(audioRef.current, volume, isMuted);
    applyAudioVolume(snippetAudioRef?.current ?? null, volume, isMuted);
    try {
      localStorage.setItem('soso_volume', String(volume));
    } catch (e) {
      logger.debug('[useAudioSettings] Failed to persist volume:', e);
    }
  }, [volume, isMuted, audioRef, snippetAudioRef]);

  // Ensure volume and playback remain completely healthy when transitioning between background and foreground
  useEffect(() => {
    const handleVisibility = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (!isMutedRef.current && volumeRef.current > 0) {
        if (
          !isCrossfadingRef.current &&
          !isAudioFading(audio) &&
          audio.volume < volumeRef.current
        ) {
          audio.volume = volumeRef.current;
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('focus', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('focus', handleVisibility);
    };
  }, [audioRef]);

  return {
    volume,
    setVolume,
    isMuted,
    toggleMute,
    previousVolume,
    isVolumeNormalizationEnabled,
    toggleVolumeNormalization,
    crossfadeDuration,
    setCrossfadeDuration,
    isScrobblingEnabled,
    toggleScrobbling,
    volumeRef,
    isMutedRef,
    isCrossfadingRef,
    crossfadeDurationRef,
    isVolumeNormalizationRef,
    isScrobblingRef,
    fadeIn,
    fadeOut,
    cancelFade,
  };
}
