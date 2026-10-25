import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import {
  alignLyricsWithChords,
  buildKaraokeLinesWithBreaks,
  type KaraokeLine,
} from '../utils/karaokeProcessing';
import { useLyricsVideo } from '../hooks/useLyricsVideo';
import React, { useEffect, useLayoutEffect, useState, useRef, useMemo, useCallback } from 'react';
import {
  Mic2,
  LocateFixed,
  Play,
  Pause,
  Music,
  Guitar,
  BookOpen,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { useKaraokeTime } from '../hooks/useKaraokeTime';
import { getKaraokeWaitFrame } from '../utils/karaokeWaitAnimation';
import { GuitarChordData, LyricsLine, SongsterrTabData } from '../types';
import { platformBridge } from '../bridge/platformBridge';
import { CatLoader } from './CatLoader';
import { GuitarChordDiagram } from './GuitarChordDiagram';
import { formatSectionHeader } from './chordDb';
import { useTheme, ACCENT_COLOR_OPTIONS } from '../context/ThemeContext';
import { isHlsVideoUrl } from '../utils/videoStreamPlayback';

interface LyricsModalProps {
  isOpen: boolean;
  layout?: 'desktop' | 'mobile';
  onClose: () => void;
}

import { transposeChordsInText } from '../utils/chordTransposer';
import { resolveTrackCover, formatTime } from '../utils/formatters';

export const LyricsModal: React.FC<LyricsModalProps> = ({
  isOpen,
  onClose,
  layout = 'desktop',
}) => {
  useLocale();
  const isMobileLayout = layout === 'mobile';
  const { currentTrack, currentTime, duration, isPlaying, seek, togglePlay, getPlaybackTime } =
    useAudio();
  const { accentColor } = useTheme();
  const accentOption =
    ACCENT_COLOR_OPTIONS.find((a) => a.id === accentColor) || ACCENT_COLOR_OPTIONS[0];
  const themeHex = accentOption?.color || '#22c55e';
  const themeRgb = accentOption?.rgb || '34, 197, 94';

  // View mode: 'lyrics' (Караоке) vs 'guitar' (Гитара: Аккорды или Табы по настройке)
  // Always prioritize 'lyrics' when opening karaoke
  const [viewMode, setViewMode] = useState<'lyrics' | 'guitar'>('lyrics');

  // Lyrics State
  const [rawLyrics, setRawLyrics] = useState<LyricsLine[] | null>(null);
  const [loadingLyrics, setLoadingLyrics] = useState<boolean>(true);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const [isAutoScroll, setIsAutoScroll] = useState<boolean>(true);
  const smoothTime = useKaraokeTime(isOpen && viewMode === 'lyrics', getPlaybackTime);

  // Settings
  const [isKaraokeChordsEnabled, setIsKaraokeChordsEnabled] = useState<boolean>(() => {
    try {
      return localStorage.getItem('soso_karaoke_chords') === 'true';
    } catch {
      return false;
    }
  });

  const [guitarPreference, setGuitarPreference] = useState<'chords' | 'tabs'>(() => {
    try {
      return (localStorage.getItem('soso_guitar_mode') as 'chords' | 'tabs') || 'chords';
    } catch {
      return 'chords';
    }
  });

  // Real-time synchronization of settings across open modals and storage
  useEffect(() => {
    const handleSettingsUpdate = () => {
      try {
        setIsKaraokeChordsEnabled(localStorage.getItem('soso_karaoke_chords') === 'true');
        setGuitarPreference(
          (localStorage.getItem('soso_guitar_mode') as 'chords' | 'tabs') || 'chords',
        );
      } catch {}
    };

    if (isOpen) {
      setViewMode('lyrics');
      setTabDisplayMode('player');
      handleSettingsUpdate();
    }

    window.addEventListener('soso:settings-changed', handleSettingsUpdate);
    window.addEventListener('storage', handleSettingsUpdate);
    return () => {
      window.removeEventListener('soso:settings-changed', handleSettingsUpdate);
      window.removeEventListener('storage', handleSettingsUpdate);
    };
  }, [isOpen]);

  // Chords State
  const [chordsData, setChordsData] = useState<GuitarChordData | null>(null);
  const [loadingChords, setLoadingChords] = useState<boolean>(false);
  const [transposeSemitones, setTransposeSemitones] = useState<number>(0);
  const [chordsFontSize, setChordsFontSize] = useState<number>(14);

  // Songsterr Tabs State
  const [songsterrData, setSongsterrData] = useState<SongsterrTabData | null>(null);
  const [, setLoadingSongsterr] = useState<boolean>(false);
  const [selectedTrackIndex, setSelectedTrackIndex] = useState<number>(0);
  const [isTabIframeLoading, setIsTabIframeLoading] = useState<boolean>(true);
  const [tabDisplayMode, setTabDisplayMode] = useState<'player' | 'tracks'>('player');
  const [trackTabOverride, setTrackTabOverride] = useState<boolean>(false);

  useEffect(() => {
    setTrackTabOverride(false);
  }, [currentTrack?.id]);

  // Chord Diagrams Library Drawer
  const [showChordDiagrams, setShowChordDiagrams] = useState<boolean>(false);

  // Dominant Ambient Background Color
  const [ambientColor, setAmbientColor] = useState<string>('#13261f');

  const {
    state: {
      activeVideoId,
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
  } = useLyricsVideo({ currentTrack, currentTime, isPlaying, isOpen, viewMode, isMobileLayout });

  const activeLineRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chordsContainerRef = useRef<HTMLDivElement | null>(null);
  // Scroll lock: prevents auto-scroll from competing with manual user scroll
  const scrollLockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrollLockedRef = useRef<boolean>(false);
  // RAF scroll pending flag: ensures we enqueue at most one smooth-scroll per animation frame
  const scrollPendingRef = useRef<boolean>(false);
  const scrollFrameRef = useRef<number | null>(null);
  const initialScrollRef = useRef(true);
  const [lyricsViewportHeight, setLyricsViewportHeight] = useState(0);
  useLayoutEffect(() => {
    if (!isOpen || viewMode !== 'lyrics' || !containerRef.current) return;
    const container = containerRef.current;
    const measure = () => setLyricsViewportHeight(container.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, [isOpen, viewMode]);
  useEffect(() => {
    if (!isOpen) return;
    isScrollLockedRef.current = false;
    initialScrollRef.current = true;
    if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
    setIsAutoScroll(true);
    return () => {
      if (scrollFrameRef.current !== null) cancelAnimationFrame(scrollFrameRef.current);
      scrollPendingRef.current = false;
      if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
    };
  }, [isOpen, currentTrack?.id]);

  // Keyboard navigation: Escape (close), Space (play/pause)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === ' ' && (e.target as HTMLElement)?.tagName !== 'INPUT') {
        e.preventDefault();
        togglePlay();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, togglePlay]);

  // Fetch both lyrics and chords when track changes or modal opens
  useEffect(() => {
    let isCancelled = false;

    const fetchData = async () => {
      if (!isOpen || !currentTrack) {
        setRawLyrics(null);
        setChordsData(null);
        setLoadingLyrics(false);
        setLoadingChords(false);
        return;
      }

      setLoadingLyrics(true);
      setLoadingChords(true);
      setLoadingSongsterr(true);
      setRawLyrics(null);
      setChordsData(null);
      setSongsterrData(null);
      setIsAutoScroll(true);
      setTransposeSemitones(0);

      const artistName =
        typeof currentTrack.artist === 'object'
          ? currentTrack.artist?.name || ''
          : String(currentTrack.artist || '');

      // 1. Fetch Lyrics (Multi-source: LRCLIB + KuGou)
      platformBridge
        .getLyrics(currentTrack.title, artistName, currentTrack.duration || duration)
        .then((res) => {
          if (!isCancelled) {
            setRawLyrics(res);
            setLoadingLyrics(false);
          }
        })
        .catch(() => {
          if (!isCancelled) setLoadingLyrics(false);
        });

      // 2. Fetch Chords in parallel (Ultimate Guitar + AmDm)
      platformBridge
        .getChords({
          title: currentTrack.title,
          artist: artistName,
        })
        .then((res) => {
          if (!isCancelled) {
            setChordsData(res);
            setLoadingChords(false);
          }
        })
        .catch(() => {
          if (!isCancelled) setLoadingChords(false);
        });

      // 3. Fetch Songsterr Tabs in parallel
      if (platformBridge.getSongsterrTab) {
        platformBridge
          .getSongsterrTab({
            title: currentTrack.title,
            artist: artistName,
          })
          .then((res) => {
            if (!isCancelled) {
              setSongsterrData(res);
              if (res && typeof res.defaultTrackIndex === 'number') {
                setSelectedTrackIndex(res.defaultTrackIndex);
              }
              setLoadingSongsterr(false);
            }
          })
          .catch(() => {
            if (!isCancelled) setLoadingSongsterr(false);
          });
      } else {
        setLoadingSongsterr(false);
      }
    };

    fetchData();

    return () => {
      isCancelled = true;
    };
  }, [isOpen, currentTrack, duration]);

  // Process and insert instrumental breaks + align with chords for synchronized karaoke
  const items = useMemo<KaraokeLine[]>(() => {
    const alignedLyrics = alignLyricsWithChords(rawLyrics || [], chordsData?.rawContent || '');
    return buildKaraokeLinesWithBreaks(alignedLyrics);
  }, [rawLyrics, chordsData]);

  const isSynced = useMemo(() => items.length > 0 && items.some((i) => i.time >= 0), [items]);

  // Determine current active karaoke line
  useEffect(() => {
    if (!items || items.length === 0 || !isSynced || viewMode !== 'lyrics') {
      setActiveIndex(-1);
      return;
    }

    let foundIdx = -1;
    for (let i = 0; i < items.length; i++) {
      if (items[i].time >= 0 && smoothTime >= items[i].time) {
        foundIdx = i;
      } else if (items[i].time > smoothTime) {
        break;
      }
    }

    setActiveIndex(foundIdx);
  }, [smoothTime, items, isSynced, viewMode]);

  // Smooth centered container scrolling without jitter
  // Uses RAF-pending flag to coalesce rapid calls (60fps) into one browser scroll call per frame.
  // Also respects the scrollLockRef so manual user scrolling is never interrupted.
  const smoothScrollToActiveLine = useCallback(() => {
    if (!isOpen || !isSynced || !isAutoScroll || isScrollLockedRef.current) return;
    if (!containerRef.current) return;
    if (scrollPendingRef.current) return; // already queued this frame

    scrollPendingRef.current = true;
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollPendingRef.current = false;
      if (!containerRef.current) return;
      if (isScrollLockedRef.current) return;

      const container = containerRef.current;
      const activeEl =
        activeLineRef.current || container.querySelector<HTMLElement>('[data-karaoke-line]');
      if (!activeEl) return;
      const lineRect = activeEl.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const targetScrollTop =
        container.scrollTop +
        lineRect.top -
        containerRect.top -
        container.clientTop -
        container.clientHeight / 2 +
        lineRect.height / 2;
      container.scrollTo({
        top: Math.max(0, targetScrollTop),
        behavior: initialScrollRef.current ? 'instant' : 'smooth',
      });
      initialScrollRef.current = false;
    });
  }, [isOpen, isSynced, isAutoScroll]);

  useEffect(() => {
    if (isSynced && viewMode === 'lyrics') {
      smoothScrollToActiveLine();
    }
  }, [
    activeIndex,
    isSynced,
    smoothScrollToActiveLine,
    viewMode,
    items,
    lyricsViewportHeight,
    isKaraokeChordsEnabled,
  ]);
  useEffect(() => {
    if (!isOpen || viewMode !== 'lyrics' || !containerRef.current?.firstElementChild) return;
    const observer = new ResizeObserver(() => smoothScrollToActiveLine());
    observer.observe(containerRef.current.firstElementChild);
    return () => observer.disconnect();
  }, [isOpen, viewMode, smoothScrollToActiveLine]);

  const handleManualScroll = () => {
    if (isSynced) {
      // Lock auto-scroll for 1500ms so it doesn't fight the user's scroll
      isScrollLockedRef.current = true;
      if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
      scrollLockTimerRef.current = setTimeout(() => {
        isScrollLockedRef.current = false;
      }, 1500);

      if (isAutoScroll) {
        setIsAutoScroll(false);
      }
    }
  };

  const handleReturnToCurrent = () => {
    isScrollLockedRef.current = false;
    if (scrollLockTimerRef.current) clearTimeout(scrollLockTimerRef.current);
    setIsAutoScroll(true);
    smoothScrollToActiveLine();
  };

  const artistName =
    typeof currentTrack?.artist === 'object'
      ? currentTrack.artist?.name
      : currentTrack?.artist || t('Исполнитель');

  const coverUrl = useMemo(() => resolveTrackCover(currentTrack), [currentTrack]);

  // Extract dominant color from cover image to tint ambient background
  useEffect(() => {
    if (!coverUrl) {
      setAmbientColor('#13261f');
      return;
    }
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = coverUrl;
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 16;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, 16, 16);
          const data = ctx.getImageData(0, 0, 16, 16).data;
          let r = 0,
            g = 0,
            b = 0,
            count = 0;
          for (let i = 0; i < data.length; i += 4) {
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
          const factor = 0.35;
          r = Math.round((r / count) * factor);
          g = Math.round((g / count) * factor);
          b = Math.round((b / count) * factor);
          setAmbientColor(`rgb(${r}, ${g}, ${b})`);
        }
      } catch {
        setAmbientColor('#13261f');
      }
    };
    img.onerror = () => {
      setAmbientColor('#13261f');
    };
  }, [coverUrl]);

  const [isSeekingProgress, setIsSeekingProgress] = useState(false);
  const [seekProgressTime, setSeekProgressTime] = useState(0);
  const progressBarRef = useRef<HTMLDivElement>(null);

  const handleProgressPointerUpdate = (
    e: React.PointerEvent<HTMLDivElement>,
    isFinal: boolean = false,
  ) => {
    if (!progressBarRef.current) return;
    const rect = progressBarRef.current.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const targetTime = ratio * (duration || 1);
    setSeekProgressTime(targetTime);

    if (videoElementRef.current) {
      videoElementRef.current.currentTime = targetTime;
    }

    if (isFinal) {
      seek(targetTime);
      if (showVideo && activeVideoId) {
        sendVideoCommand('seekTo', [targetTime, true]);
      }
      setIsSeekingProgress(false);
    }
  };

  const handleProgressPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsSeekingProgress(true);
    handleProgressPointerUpdate(e, false);
  };

  const handleProgressPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isSeekingProgress) {
      handleProgressPointerUpdate(e, false);
    }
  };

  const handleProgressPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    handleProgressPointerUpdate(e, true);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const hasValidLyrics = items.length > 0;
  const hasValidChords = Boolean(
    chordsData && chordsData.rawContent && chordsData.rawContent.trim().length > 0,
  );
  const hasValidTabs = Boolean(
    songsterrData && songsterrData.tracks && songsterrData.tracks.length > 0,
  );

  // Dynamic guitar mode derived from settings preference and per-track override
  const effectiveGuitarMode = useMemo<'chords' | 'tabs'>(() => {
    if (trackTabOverride && hasValidTabs) {
      return 'tabs';
    }
    if (guitarPreference === 'tabs') {
      return 'tabs';
    }
    return 'chords';
  }, [guitarPreference, trackTabOverride, hasValidTabs]);

  const switchGuitarPreference = (mode: 'chords' | 'tabs') => {
    setGuitarPreference(mode);
    try {
      localStorage.setItem('soso_guitar_mode', mode);
      window.dispatchEvent(
        new CustomEvent('soso:settings-changed', {
          detail: { key: 'soso_guitar_mode', value: mode },
        }),
      );
    } catch {}
  };

  // Processed chords content with transposition for full sheet
  const transposedChordsContent = useMemo(() => {
    if (!chordsData || !chordsData.rawContent) return '';
    return transposeChordsInText(chordsData.rawContent, transposeSemitones);
  }, [chordsData, transposeSemitones]);

  // Extract unique chords used in this song for the Chord Library Diagrams Bar
  const uniqueSongChords = useMemo(() => {
    if (!transposedChordsContent) return [];
    const matches = transposedChordsContent.match(/\[ch\]([^\[]+)\[\/ch\]/g) || [];
    const rawSet = Array.from(new Set(matches.map((c) => c.slice(4, -5).trim())));
    return rawSet.filter((c) => c.length > 0);
  }, [transposedChordsContent]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('Караоке')}
      className={`karaoke-modal ${isMobileLayout ? 'mobile-karaoke' : ''} fixed inset-0 z-50 flex flex-col overflow-hidden text-white select-none animate-fade-in transition-colors duration-700`}
      style={{ backgroundColor: ambientColor, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* Dynamic Glowing Ambient Background */}
      {coverUrl ? (
        <div
          className="absolute inset-0 pointer-events-none opacity-30 filter blur-[100px] scale-125 bg-cover bg-center transition-all duration-1000"
          style={{ backgroundImage: `url(${coverUrl})` }}
        />
      ) : null}
      <div className="absolute inset-0 pointer-events-none bg-linear-to-b from-black/50 via-black/20 to-black/75" />

      {/* Modal Header */}
      <div
        className="karaoke-header relative z-30 flex items-center justify-between px-6 lg:px-12 py-4 shrink-0 gap-4"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Left: Track Info in Chords/Tabs mode; subtle spacer in Lyrics mode */}
        {viewMode !== 'lyrics' ? (
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative w-10 h-10 rounded-xl overflow-hidden bg-white/10 shrink-0 shadow-lg ring-1 ring-white/15">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={currentTrack?.title || t('Обложка')}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-soso-brand bg-soso-brand/20">
                  <Music className="w-5 h-5" />
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-sm font-bold text-white truncate drop-shadow-xs">
                {currentTrack?.title || t('Без названия')}
              </h3>
              <p className="text-xs text-zinc-400 font-semibold truncate">{artistName}</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-1 min-w-0" />
        )}

        {/* Center: Mode Switcher [ 🎤 Караоке ] vs [ 🎸 Гитара ] */}
        {hasValidLyrics && (hasValidChords || hasValidTabs) && (
          <div
            className="flex items-center p-1 bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 shrink-0 shadow-xl gap-1"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          >
            <button
              type="button"
              onClick={() => setViewMode('lyrics')}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'lyrics'
                  ? 'bg-white text-black shadow-lg scale-[1.02]'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <Mic2 className="w-3.5 h-3.5" />
              <span>{t('Караоке')}</span>
            </button>

            <button
              type="button"
              onClick={() => setViewMode('guitar')}
              style={{
                backgroundColor: viewMode === 'guitar' ? themeHex : undefined,
                color: viewMode === 'guitar' ? '#000000' : undefined,
                boxShadow:
                  viewMode === 'guitar' ? `0 10px 15px -3px rgba(${themeRgb}, 0.3)` : undefined,
              }}
              className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                viewMode === 'guitar'
                  ? 'scale-[1.02]'
                  : 'text-zinc-300 hover:text-white hover:bg-white/10'
              }`}
            >
              <Guitar className="w-3.5 h-3.5" />
              <span>{t('Гитара')}</span>
            </button>
          </div>
        )}

        {/* Right: Circular Collapse Button (matching user's screenshot) */}
        <div
          className="flex items-center gap-3 flex-1 justify-end"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {viewMode !== 'lyrics' && (
            <button
              type="button"
              onClick={togglePlay}
              title={isPlaying ? t('Пауза (Пробел)') : t('Воспроизвести (Пробел)')}
              className="p-2.5 rounded-full bg-white/10 hover:bg-white/20 text-zinc-300 hover:text-white transition-all border border-white/10 active:scale-95 shadow-xs"
            >
              {isPlaying ? (
                <Pause className="w-4 h-4 fill-current" />
              ) : (
                <Play className="w-4 h-4 fill-current ml-0.5" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={t('Свернуть караоке')}
            title={t('Свернуть (Esc)')}
            className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all active:scale-95 shadow-xl border border-white/15"
          >
            <ChevronDown className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* ===================== VIEW 1: STUDIO KARAOKE (Screenshot 2-Column Design) ===================== */}
      {viewMode === 'lyrics' && (
        <div className="karaoke-body relative z-10 flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
          {/* LEFT COLUMN: Media (Artwork / Video Clip) + Info + Progress */}
          <div
            data-video={showVideo && activeVideoId ? 'true' : 'false'}
            className="karaoke-media w-full md:w-[45%] lg:w-[40%] xl:w-[36%] flex flex-col items-center justify-center p-6 lg:p-12 space-y-4 select-none shrink-0"
          >
            {/* Square Media Box */}
            <div className="karaoke-art relative w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80 lg:w-[350px] lg:h-[350px] xl:w-[380px] xl:h-[380px] aspect-square rounded-3xl overflow-hidden shadow-2xl shadow-black/80 ring-1 ring-white/15 group bg-black/40">
              {showVideo && activeVideoId && !isResolvingVideoStream ? (
                <div className="absolute inset-0 flex items-center justify-center overflow-hidden bg-black pointer-events-none">
                  {videoStreamUrl ? (
                    <video
                      ref={videoElementRef}
                      data-clip-id={activeVideoId}
                      key={activeVideoId + ':' + videoStreamUrl}
                      muted
                      playsInline
                      autoPlay={isPlaying}
                      className={
                        isMobileLayout
                          ? 'w-full h-full object-contain select-none pointer-events-none'
                          : 'w-full h-full object-cover select-none pointer-events-none'
                      }
                      onError={(event) => {
                        if (event.currentTarget !== videoElementRef.current) return;
                        window.electronAPI?.logPlaybackEvent?.(
                          'warn',
                          '[Clip:Playback] clip=' +
                            activeVideoId +
                            ' media-error=' +
                            event.currentTarget.error?.code,
                        );
                        if (!isHlsVideoUrl(videoStreamUrl)) handleDirectVideoFailure();
                      }}
                    />
                  ) : (
                    <iframe
                      ref={videoIframeRef}
                      key={activeVideoId}
                      src={`https://www.youtube-nocookie.com/embed/${activeVideoId}?autoplay=1&mute=1&controls=0&playsinline=1&enablejsapi=1&rel=0`}
                      title="Music Video"
                      className={
                        isMobileLayout
                          ? 'w-full h-full border-0'
                          : 'w-[178%] h-full min-w-[178%] min-h-full border-0 select-none scale-[1.04]'
                      }
                      allow="autoplay; encrypted-media; picture-in-picture"
                      onError={() => {
                        console.warn(
                          '[LyricsModal] Video iframe failed to load, switching to cover',
                        );
                        setShowVideo(false);
                        setClipPlaybackError('unavailable');
                      }}
                      onLoad={() => {
                        videoIframeRef.current?.contentWindow?.postMessage(
                          JSON.stringify({ event: 'listening' }),
                          '*',
                        );
                        sendVideoCommand('addEventListener', ['onError']);
                        sendVideoCommand('addEventListener', ['onStateChange']);
                        sendVideoCommand('mute');
                        sendVideoCommand('seekTo', [currentTime, true]);
                        if (isPlaying) {
                          sendVideoCommand('playVideo');
                        } else {
                          sendVideoCommand('pauseVideo');
                        }
                      }}
                    />
                  )}
                </div>
              ) : coverUrl ? (
                <img
                  src={coverUrl}
                  alt={currentTrack?.title || t('Обложка')}
                  className="w-full h-full object-cover select-none"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center text-soso-brand bg-soso-brand/20">
                  <Music className="w-16 h-16 opacity-40" />
                </div>
              )}

              {/* Toggle button: Клип / Обложка */}
              {isClipSearchEnabled && (
                <button
                  type="button"
                  disabled={youtubeDisabled}
                  data-youtube-disabled={youtubeDisabled ? 'true' : undefined}
                  onClick={handleVideoToggle}
                  aria-label={
                    showVideo && activeVideoId ? t('Показать обложку') : t('Показать клип')
                  }
                  className="absolute bottom-3.5 right-3.5 px-3 py-1.5 rounded-full bg-black/60 hover:bg-black/80 backdrop-blur-md border border-white/20 text-xs font-bold text-white flex items-center gap-1.5 shadow-2xl transition-all active:scale-95 z-20 pointer-events-auto"
                  data-youtube-access-error={
                    clipPlaybackError && clipPlaybackError !== 'unavailable'
                      ? clipPlaybackError
                      : undefined
                  }
                  title={
                    clipPlaybackError === 'age-restricted'
                      ? t('YouTube требует подтверждения возраста')
                      : clipPlaybackError === 'verification-required'
                        ? t('YouTube требует проверки на бота')
                        : clipPlaybackError === 'sign-in-required'
                          ? t('YouTube требует входа')
                          : clipPlaybackError
                            ? t('Повторить загрузку найденного клипа')
                            : !activeVideoId
                              ? t('Проверить наличие официального клипа')
                              : showVideo
                                ? t('Показать обложку альбома')
                                : t('Показать видеоклип')
                  }
                >
                  {showVideo && activeVideoId ? (
                    <>
                      <Music className="w-3.5 h-3.5" />
                      <span>{t('Обложка')}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>
                        {clipPlaybackError === 'age-restricted'
                          ? t('Клип 18+')
                          : clipPlaybackError === 'verification-required'
                            ? t('Проверка YouTube')
                            : clipPlaybackError === 'sign-in-required'
                              ? t('Войти в YouTube')
                              : clipPlaybackError
                                ? t('Повторить')
                                : t('Клип')}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>

            {/* Track Info (Title + Artist) */}
            <div className="karaoke-track-info w-full max-w-[340px] lg:max-w-[380px] text-center px-2">
              <h2 className="text-base sm:text-lg lg:text-xl font-bold text-white truncate drop-shadow-md">
                {currentTrack?.title || t('Без названия')}
              </h2>
              <p className="text-xs sm:text-sm font-semibold text-white/70 uppercase tracking-wider truncate mt-1">
                {artistName}
              </p>
            </div>

            {/* Minimalist Progress Bar with Dragging / Scrubbing */}
            <div className="karaoke-progress w-full max-w-[280px] sm:max-w-[340px] flex flex-col gap-1.5 pt-1 font-sans tabular-nums">
              <div
                ref={progressBarRef}
                onPointerDown={handleProgressPointerDown}
                onPointerMove={handleProgressPointerMove}
                onPointerUp={handleProgressPointerUp}
                onPointerCancel={handleProgressPointerUp}
                className="relative py-2 -my-2 flex items-center cursor-pointer touch-none select-none group"
              >
                <div className="w-full h-1.5 group-hover:h-2 bg-white/20 group-hover:bg-white/30 rounded-full overflow-hidden transition-all shadow-inner">
                  <div
                    className="h-full bg-white rounded-full pointer-events-none transition-[width] duration-75 ease-out"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.max(
                          0,
                          ((isSeekingProgress ? seekProgressTime : currentTime) / (duration || 1)) *
                            100,
                        ),
                      )}%`,
                    }}
                  />
                </div>

                {/* Visible Thumb Handle on Hover & Drag */}
                <div
                  className={`absolute top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white rounded-full shadow-lg pointer-events-none transition-transform ${
                    isSeekingProgress
                      ? 'opacity-100 scale-125'
                      : 'opacity-0 group-hover:opacity-100'
                  }`}
                  style={{
                    left: `calc(${Math.min(
                      100,
                      Math.max(
                        0,
                        ((isSeekingProgress ? seekProgressTime : currentTime) / (duration || 1)) *
                          100,
                      ),
                    )}% - 7px)`,
                  }}
                />
              </div>

              <div className="flex items-center justify-between text-[11px] font-medium text-white/50 px-0.5">
                <span>{formatTime(isSeekingProgress ? seekProgressTime : currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              {/* Play/Pause Button Under Progress Bar */}
              <div className="flex items-center justify-center pt-2">
                <button
                  type="button"
                  onClick={togglePlay}
                  title={isPlaying ? t('Пауза (Пробел)') : t('Воспроизвести (Пробел)')}
                  className="w-11 h-11 rounded-full bg-white text-black hover:bg-white/90 flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-xl shadow-black/40"
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN: Synchronized Karaoke Lyrics (Left-aligned & Centered) */}
          <div className="karaoke-lyrics-column flex-1 flex flex-col min-h-0 relative px-6 sm:px-10 lg:px-16 overflow-hidden">
            <div className="w-full max-w-2xl h-full flex flex-col relative mx-auto lg:mx-0">
              <div
                ref={containerRef}
                onWheel={handleManualScroll}
                onTouchMove={handleManualScroll}
                className="karaoke-lyrics-scroll relative z-10 flex-1 min-h-0 overflow-y-auto text-left no-scrollbar select-none"
              >
                <div
                  className="space-y-3.5"
                  style={{
                    paddingTop: 20,
                    paddingBottom: Math.max(20, lyricsViewportHeight / 2 - 20),
                  }}
                >
                  {loadingLyrics ? (
                    <CatLoader message={t('Синхронизация текста...')} size="md" className="py-24" />
                  ) : !hasValidLyrics ? (
                    <div className="py-24 space-y-4 max-w-sm">
                      <div className="w-16 h-16 rounded-3xl bg-white/5 text-zinc-400 flex items-center justify-center ring-1 ring-white/10">
                        <Music className="w-8 h-8 opacity-40" />
                      </div>
                      <h3 className="text-lg font-bold text-white">
                        {t('Текст песни пока не найден')}
                      </h3>
                      <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                        {t('Для этого трека текст ещё не добавлен в каталог.')}
                      </p>
                    </div>
                  ) : (
                    items.map((item, idx) => {
                      const isActive = isSynced && activeIndex === idx;
                      const distance = Math.abs(activeIndex - idx);

                      if (item.isInstrumentalBreak) {
                        const nextLineTime = items[idx + 1]?.time ?? item.time;
                        const wait = getKaraokeWaitFrame(smoothTime, nextLineTime, isActive);
                        return (
                          <div
                            key={item.id}
                            data-karaoke-line
                            ref={isActive ? activeLineRef : null}
                            className={`py-3.5 transition-opacity duration-200 flex items-center pl-1 ${
                              isActive ? 'opacity-100' : 'opacity-25'
                            }`}
                          >
                            <div
                              className="karaoke-wait"
                              data-active={isActive}
                              data-phase={wait.phase}
                              data-countdown={wait.digit ?? undefined}
                              style={{ color: isActive ? themeHex : 'rgba(255,255,255,0.4)' }}
                              role="img"
                              aria-label={
                                wait.digit
                                  ? t('До следующей строки: {0}', wait.digit)
                                  : t('Инструментальный фрагмент')
                              }
                            >
                              <svg
                                className="karaoke-wait-motion"
                                width="64"
                                height="40"
                                viewBox="0 0 76 52"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth={wait.strokeWidth}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                {wait.paths.map((path, index) => (
                                  <path
                                    key={index}
                                    d={path}
                                    pathLength={1}
                                    strokeDasharray={wait.strokeDasharray}
                                    strokeDashoffset={wait.strokeDashoffset}
                                  />
                                ))}
                              </svg>
                              <span className="karaoke-wait-still" aria-hidden="true">
                                {wait.digit ?? '• • •'}
                              </span>
                            </div>
                          </div>
                        );
                      }

                      // Line typography matching the reference screenshot - refined scale to prevent excessive wrapping
                      let lineStyle = '';
                      if (!isSynced) {
                        lineStyle =
                          'text-white/80 font-semibold text-lg sm:text-xl leading-relaxed cursor-text select-text';
                      } else if (isActive) {
                        lineStyle =
                          'text-white font-black text-2xl sm:text-3xl lg:text-[32px] leading-snug tracking-tight drop-shadow-md origin-left';
                      } else {
                        const opacityClass =
                          distance === 1
                            ? 'text-white/45 hover:text-white/80'
                            : distance === 2
                              ? 'text-white/25 hover:text-white/70'
                              : 'text-white/15 hover:text-white/50';
                        lineStyle = `font-bold text-lg sm:text-xl lg:text-2xl leading-normal tracking-tight origin-left ${opacityClass}`;
                      }

                      const lineChordsTransposed =
                        item.chords && isKaraokeChordsEnabled
                          ? transposeChordsInText(item.chords, transposeSemitones)
                          : '';

                      return (
                        <div
                          key={item.id}
                          data-karaoke-line
                          ref={isActive ? activeLineRef : null}
                          onClick={() => {
                            if (isSynced && item.time >= 0) {
                              isScrollLockedRef.current = false;
                              if (scrollLockTimerRef.current)
                                clearTimeout(scrollLockTimerRef.current);
                              seek(item.time);
                              if (videoElementRef.current) {
                                videoElementRef.current.currentTime = item.time;
                              }
                              if (showVideo && activeVideoId) {
                                sendVideoCommand('seekTo', [item.time, true]);
                              }
                              setIsAutoScroll(true);
                            }
                          }}
                          style={{ willChange: 'transform, opacity' }}
                          className={`transition-all duration-300 ease-out py-1 rounded-xl ${
                            isSynced ? 'cursor-pointer' : 'cursor-text'
                          } ${lineStyle}`}
                        >
                          {/* Synchronized Chords Badges if enabled */}
                          {lineChordsTransposed && (
                            <div className="mb-1 flex items-center gap-1.5 flex-wrap font-mono">
                              {lineChordsTransposed
                                .split(/(\[ch\][^\[]+\[\/ch\])/g)
                                .filter((p) => p.startsWith('[ch]') && p.endsWith('[/ch]'))
                                .map((p, pIdx) => {
                                  const chord = p.slice(4, -5);
                                  return (
                                    <span
                                      key={pIdx}
                                      style={{
                                        backgroundColor: isActive
                                          ? themeHex
                                          : `rgba(${themeRgb}, 0.18)`,
                                        color: isActive ? '#000000' : themeHex,
                                        borderColor: isActive
                                          ? undefined
                                          : `rgba(${themeRgb}, 0.35)`,
                                      }}
                                      className={`inline-block px-2 py-0.5 rounded-lg text-xs font-black transition-all shadow-md ${
                                        isActive ? 'scale-110 shadow-lg' : 'border'
                                      }`}
                                    >
                                      {chord}
                                    </span>
                                  );
                                })}
                            </div>
                          )}

                          <span className="select-text tracking-tight block">{item.text}</span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Floating Return to Current Line Button */}
              {!isAutoScroll && isSynced && activeIndex >= 0 && (
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-30 animate-scale-in">
                  <button
                    type="button"
                    onClick={handleReturnToCurrent}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-white text-black font-black text-xs shadow-2xl hover:scale-105 active:scale-95 transition-all"
                  >
                    <LocateFixed className="w-4 h-4" />
                    <span>{t('К текущей строке')}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== VIEW 2: FULL GUITAR TAB SHEET WITH CHORD DIAGRAMS ===================== */}
      {viewMode === 'guitar' && effectiveGuitarMode === 'chords' && (
        <div className="relative z-10 flex-1 flex flex-col min-h-0">
          {/* Chords Quick Toolbar */}
          <div className="px-6 py-2.5 bg-black/50 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs">
            {/* Left: Metadata Badges + Fallback prompt if tabs preferred + Chord Library Button */}
            <div className="flex items-center gap-2 flex-wrap">
              {guitarPreference === 'tabs' && !hasValidTabs && hasValidChords && (
                <span className="px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-300 font-semibold">
                  {t('Табы не найдены • показаны аккорды')}
                </span>
              )}
              {uniqueSongChords.length > 0 && (
                <button
                  onClick={() => setShowChordDiagrams((prev) => !prev)}
                  style={{
                    backgroundColor: showChordDiagrams ? themeHex : undefined,
                    color: showChordDiagrams ? '#000000' : themeHex,
                    borderColor: showChordDiagrams ? themeHex : `rgba(${themeRgb}, 0.35)`,
                  }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-bold transition-all border ${
                    showChordDiagrams ? 'shadow-md shadow-black/40' : 'bg-white/5 hover:bg-white/10'
                  }`}
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>
                    {t('Схемы аккордов (')}
                    {uniqueSongChords.length})
                  </span>
                  {showChordDiagrams ? (
                    <ChevronUp className="w-3.5 h-3.5" />
                  ) : (
                    <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>
              )}

              {chordsData?.key && (
                <span
                  style={{
                    backgroundColor: `rgba(${themeRgb}, 0.15)`,
                    borderColor: `rgba(${themeRgb}, 0.35)`,
                    color: themeHex,
                  }}
                  className="px-2.5 py-1 rounded-lg border font-bold"
                >
                  {t('Тональность: ')}
                  <strong className="text-white">{chordsData.key}</strong>
                </span>
              )}
              {chordsData?.tuning && (
                <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-300 font-semibold">
                  {t('Строй: ')}
                  <strong className="text-white">{chordsData.tuning}</strong>
                </span>
              )}
              {typeof chordsData?.capo === 'number' && (
                <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-300 font-semibold">
                  {t('Каподастр:')}{' '}
                  <strong className="text-white">
                    {chordsData.capo > 0 ? t('{0} лад', chordsData.capo) : t('Нет')}
                  </strong>
                </span>
              )}
            </div>

            {/* Right: Controls (Transpose, Autoscroll, Font Size) */}
            <div className="flex items-center gap-3 flex-wrap">
              {/* Transpose Controls */}
              <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-xl border border-white/10">
                <span className="text-[11px] text-zinc-400 font-semibold pr-1">
                  {t('Транспонирование:')}
                </span>
                <button
                  onClick={() => setTransposeSemitones((prev) => prev - 1)}
                  title={t('На полутон ниже')}
                  className="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 text-white font-black flex items-center justify-center active:scale-90"
                >
                  -
                </button>
                <span className="px-1.5 font-mono font-bold text-amber-400 min-w-[28px] text-center">
                  {transposeSemitones === 0
                    ? '0'
                    : transposeSemitones > 0
                      ? `+${transposeSemitones}`
                      : transposeSemitones}
                </span>
                <button
                  onClick={() => setTransposeSemitones((prev) => prev + 1)}
                  title={t('На полутон выше')}
                  className="w-6 h-6 rounded-lg bg-white/10 hover:bg-white/20 text-white font-black flex items-center justify-center active:scale-90"
                >
                  +
                </button>
                {transposeSemitones !== 0 && (
                  <button
                    onClick={() => setTransposeSemitones(0)}
                    title={t('Сбросить в оригинал')}
                    className="ml-1 text-[10px] text-zinc-400 hover:text-white underline"
                  >
                    {t('Сброс')}
                  </button>
                )}
              </div>

              {/* Font Size */}
              <div className="flex items-center gap-1 bg-white/5 px-2 py-1 rounded-xl border border-white/10">
                <button
                  onClick={() => setChordsFontSize((prev) => Math.max(12, prev - 1))}
                  title={t('Уменьшить шрифт')}
                  className="w-5 h-5 rounded hover:bg-white/10 text-zinc-300 hover:text-white font-bold flex items-center justify-center"
                >
                  A-
                </button>
                <span className="text-[10px] font-mono text-zinc-400">{chordsFontSize}px</span>
                <button
                  onClick={() => setChordsFontSize((prev) => Math.min(22, prev + 1))}
                  title={t('Увеличить шрифт')}
                  className="w-5 h-5 rounded hover:bg-white/10 text-zinc-300 hover:text-white font-bold flex items-center justify-center"
                >
                  A+
                </button>
              </div>
            </div>
          </div>

          {/* CHORD DIAGRAMS CAROUSEL BAR */}
          {showChordDiagrams && uniqueSongChords.length > 0 && (
            <div className="px-6 py-3 bg-zinc-950/80 border-b border-white/10 overflow-x-auto flex items-center gap-3 no-scrollbar animate-fade-in shadow-inner">
              {uniqueSongChords.map((chord) => (
                <div key={chord} className="shrink-0">
                  <GuitarChordDiagram chord={chord} size="sm" />
                </div>
              ))}
            </div>
          )}

          {/* Chords Body Area with Strict Character Grid Alignment */}
          <div
            ref={chordsContainerRef}
            className="flex-1 overflow-x-auto overflow-y-auto p-6 sm:p-10 select-text leading-relaxed no-scrollbar"
            style={{
              fontSize: `${chordsFontSize}px`,
              fontFamily: `'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', 'Courier New', monospace`,
              lineHeight: '1.7',
            }}
          >
            {loadingChords ? (
              <CatLoader message={t('Поиск аккордов...')} size="md" className="py-24" />
            ) : !chordsData || !chordsData.rawContent ? (
              <div className="py-24 space-y-4 max-w-sm mx-auto text-center font-sans">
                <div className="w-16 h-16 rounded-3xl bg-amber-500/10 text-amber-400 flex items-center justify-center mx-auto ring-1 ring-amber-500/20">
                  <Guitar className="w-8 h-8 opacity-60" />
                </div>
                <h3 className="text-lg font-bold text-white">{t('Аккорды пока не найдены')}</h3>
                <p className="text-xs text-zinc-400 leading-relaxed font-normal">
                  {t('Для трека «')}
                  {currentTrack?.title}
                  {t('» не удалось автоматически подобрать проверенные аккорды.')}
                </p>
                {hasValidTabs && (
                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={() => setTrackTabOverride(true)}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-2xl bg-[#1877F2] hover:bg-[#1877F2]/90 text-white font-bold text-xs shadow-xl hover:scale-105 active:scale-95 transition-all cursor-pointer"
                    >
                      <Music className="w-4 h-4" />
                      <span>{t('Открыть табы Songsterr для этого трека')}</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="max-w-3xl mx-auto space-y-0.5 font-mono whitespace-pre">
                {transposedChordsContent.split('\n').map((rawLine, lineIdx) => {
                  // Sanitize line: clean HTML entities, bbcode tags
                  const line = rawLine
                    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(Number(dec)))
                    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) =>
                      String.fromCharCode(parseInt(hex, 16)),
                    )
                    .replace(/&quot;/g, '"')
                    .replace(/&amp;/g, '&')
                    .replace(/&lt;/g, '<')
                    .replace(/&gt;/g, '>')
                    .replace(/&#039;/g, "'")
                    .replace(/&#39;/g, "'")
                    .replace(/&apos;/g, "'")
                    .replace(/&#x27;/g, "'")
                    .replace(/&nbsp;/g, ' ')
                    .replace(/&laquo;/g, '«')
                    .replace(/&raquo;/g, '»')
                    .replace(/&ndash;/g, '–')
                    .replace(/&mdash;/g, '—')
                    .replace(/\[\/?(b|i|u|s|sub|sup)\]/gi, '');

                  const cleanLine = line.trim();

                  // Section headers translated to clean Russian (Verse -> Куплет, Chorus -> Припев, etc.)
                  if (
                    /^\[(intro|verse|versus|chorus|bridge|solo|outro|pre-chorus|interlude|hook|куплет|припев|вступление|проигрыш|кода)[^\]]*\]$/i.test(
                      cleanLine,
                    )
                  ) {
                    const russianHeader = formatSectionHeader(cleanLine);
                    return (
                      <div key={lineIdx} className="pt-6 pb-1 font-sans">
                        <span
                          style={{
                            background: `linear-gradient(to right, rgba(${themeRgb}, 0.25), rgba(${themeRgb}, 0.1), transparent)`,
                            borderColor: `rgba(${themeRgb}, 0.4)`,
                            color: themeHex,
                          }}
                          className="inline-block px-3.5 py-1 rounded-xl font-sans font-black text-xs uppercase tracking-wider border shadow-md"
                        >
                          {russianHeader}
                        </span>
                      </div>
                    );
                  }

                  // Format chords marked with [ch]...[/ch]
                  const parts = line.split(/(\[ch\][^\[]+\[\/ch\]|\[tab\][\s\S]*?\[\/tab\])/g);
                  return (
                    <div
                      key={lineIdx}
                      className="min-h-[1.5em] leading-relaxed text-zinc-200 font-mono whitespace-pre"
                    >
                      {parts.map((part, partIdx) => {
                        if (part.startsWith('[ch]') && part.endsWith('[/ch]')) {
                          const chord = part.slice(4, -5);
                          return (
                            <span
                              key={partIdx}
                              title={t('Аккорд: {0}', chord)}
                              onClick={() => setShowChordDiagrams(true)}
                              style={{
                                color: themeHex,
                                backgroundColor: `rgba(${themeRgb}, 0.18)`,
                              }}
                              className="font-bold px-0.5 rounded text-[1em] hover:brightness-125 transition-all cursor-pointer"
                            >
                              {chord}
                            </span>
                          );
                        }
                        // Remove tab wrappers
                        const cleanPart = part.replace(/\[\/?tab\]/g, '');
                        return <span key={partIdx}>{cleanPart}</span>;
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===================== VIEW 3: SONGSTERR GUITAR & BASS TABS ===================== */}
      {viewMode === 'guitar' && effectiveGuitarMode === 'tabs' && (
        <div className="relative z-10 flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Songsterr Quick Toolbar */}
          <div className="px-6 py-2.5 bg-black/50 border-b border-white/10 flex flex-wrap items-center justify-between gap-3 text-xs shrink-0">
            <div className="flex items-center gap-2 flex-wrap">
              {trackTabOverride && (
                <button
                  type="button"
                  onClick={() => setTrackTabOverride(false)}
                  className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-zinc-200 hover:text-white font-bold text-xs transition-all mr-1 border border-white/15"
                >
                  {t('← К аккордам')}
                </button>
              )}
              {hasValidChords && hasValidTabs && (
                <div className="flex items-center p-0.5 bg-white/5 rounded-xl border border-white/10 mr-1">
                  <button
                    type="button"
                    onClick={() => switchGuitarPreference('chords')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      guitarPreference === 'chords'
                        ? 'bg-white/20 text-white shadow-xs'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {t('Аккорды')}
                  </button>
                  <button
                    type="button"
                    onClick={() => switchGuitarPreference('tabs')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                      guitarPreference === 'tabs'
                        ? 'bg-[#1877F2] text-white shadow-xs'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {t('Табы')}
                  </button>
                </div>
              )}
              {/* Available tracks quick-select pills */}
              {songsterrData?.tracks && songsterrData.tracks.length > 0 && (
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar max-w-md py-0.5">
                  {songsterrData.tracks.map((tr, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => {
                        setSelectedTrackIndex(idx);
                        setIsTabIframeLoading(true);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-all border ${
                        idx === selectedTrackIndex
                          ? 'bg-[#1877F2] text-white border-[#1877F2] shadow-xs'
                          : 'bg-white/5 hover:bg-white/10 text-zinc-300 border-white/5'
                      }`}
                    >
                      {tr.instrument || tr.name}
                    </button>
                  ))}
                </div>
              )}

              {songsterrData?.tracks?.[selectedTrackIndex]?.tuning && (
                <span className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-zinc-300 font-semibold">
                  {songsterrData.tracks[selectedTrackIndex].tuning}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {/* Switch between embedded player and track overview list */}
              <div className="flex items-center p-0.5 bg-white/5 rounded-xl border border-white/10">
                <button
                  type="button"
                  onClick={() => setTabDisplayMode('player')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    tabDisplayMode === 'player'
                      ? 'bg-[#1877F2] text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {t('Плеер')}
                </button>
                <button
                  type="button"
                  onClick={() => setTabDisplayMode('tracks')}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all ${
                    tabDisplayMode === 'tracks'
                      ? 'bg-[#1877F2] text-white shadow-xs'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {t('Дорожки (')}
                  {songsterrData?.tracks?.length || 0})
                </button>
              </div>

              {songsterrData?.songsterrUrl && (
                <button
                  type="button"
                  onClick={() => {
                    if ((window as any).electronAPI?.openExternal) {
                      (window as any).electronAPI.openExternal(songsterrData.songsterrUrl);
                    } else {
                      window.open(songsterrData.songsterrUrl, '_blank');
                    }
                  }}
                  title={t('Открыть на сайте Songsterr в отдельном окне браузера')}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 hover:text-white font-bold transition-all border border-white/10 active:scale-95"
                >
                  <span>{t('В браузере')}</span>
                  <ExternalLink className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Main Tabs Area */}
          {tabDisplayMode === 'player' && songsterrData?.songId ? (
            <div className="relative flex-1 w-full h-full min-h-0 bg-zinc-950">
              {isTabIframeLoading && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 z-20 gap-3">
                  <Loader2 className="w-8 h-8 text-[#1877F2] animate-spin" />
                  <span className="text-xs text-zinc-400 font-medium">
                    {t('Загрузка интерактивных таб Songsterr...')}
                  </span>
                </div>
              )}
              <iframe
                key={`${songsterrData.songId}_${selectedTrackIndex}`}
                src={`https://www.songsterr.com/a/wa/song?id=${songsterrData.songId}&track=${selectedTrackIndex}`}
                title={`Songsterr Tab - ${songsterrData.title}`}
                className="w-full h-full border-0"
                allow="autoplay; fullscreen"
                onLoad={() => setIsTabIframeLoading(false)}
              />
            </div>
          ) : (
            /* Tracks List & Details */
            <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-5">
              <div className="max-w-3xl mx-auto space-y-5">
                {/* Track Header Card */}
                <div className="p-5 rounded-2xl bg-white/[0.03] border border-white/10 shadow-xl flex items-center justify-between">
                  <div>
                    <h3 className="text-lg font-black text-white">{songsterrData?.title}</h3>
                    <p className="text-sm text-zinc-400">{songsterrData?.artist}</p>
                  </div>
                  {songsterrData?.hasPlayer && (
                    <span className="px-3 py-1 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-bold border border-emerald-500/30">
                      {t('Интерактивный плеер')}
                    </span>
                  )}
                </div>

                {/* Available Instrument Tracks */}
                <div>
                  <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2.5">
                    {t('Дорожки табулатуры (')}
                    {songsterrData?.tracks?.length || 0})
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {songsterrData?.tracks?.map((tr, idx) => {
                      const isSelected = idx === selectedTrackIndex;
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            setSelectedTrackIndex(idx);
                            setTabDisplayMode('player');
                            setIsTabIframeLoading(true);
                          }}
                          className={`p-3.5 rounded-xl text-left transition-all border flex flex-col justify-between gap-1.5 ${
                            isSelected
                              ? 'bg-[#1877F2]/20 border-[#1877F2]/50 shadow-lg shadow-[#1877F2]/10 ring-1 ring-[#1877F2]/40'
                              : 'bg-white/[0.02] hover:bg-white/[0.05] border-white/5 text-zinc-300'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-sm text-white">{tr.instrument}</span>
                            {tr.difficulty !== undefined && (
                              <span className="text-[11px] font-mono text-amber-400">
                                {tr.difficulty}/10
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-zinc-400 font-medium truncate">
                            {tr.name}
                          </div>
                          <div className="text-[11px] text-zinc-500 font-mono">{tr.tuning}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Open Songsterr Player Callout */}
                <div className="p-6 rounded-2xl bg-linear-to-r from-blue-900/30 via-indigo-900/20 to-blue-900/30 border border-blue-500/25 text-center space-y-3">
                  <Guitar className="w-9 h-9 text-[#1877F2] mx-auto" />
                  <div>
                    <div className="font-bold text-white text-base">
                      {t('Интерактивный плеер Songsterr')}
                    </div>
                    <p className="text-xs text-zinc-400 max-w-md mx-auto mt-1">
                      {t(
                        'Нотная табулатура, бегущий маркер по тактам, авто-прокрутка, регулировка темпа и микшер дорожек',
                      )}
                    </p>
                  </div>
                  <div className="flex items-center justify-center gap-3 flex-wrap">
                    <button
                      type="button"
                      onClick={() => {
                        setTabDisplayMode('player');
                        setIsTabIframeLoading(true);
                      }}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#166fe5] text-white font-bold text-xs transition-all shadow-lg shadow-blue-600/40 active:scale-95"
                    >
                      <Guitar className="w-4 h-4" />
                      <span>{t('Открыть интерактивный плеер')}</span>
                    </button>
                    {songsterrData?.songsterrUrl && (
                      <button
                        type="button"
                        onClick={() => {
                          if ((window as any).electronAPI?.openExternal) {
                            (window as any).electronAPI.openExternal(songsterrData.songsterrUrl);
                          } else {
                            window.open(songsterrData.songsterrUrl, '_blank');
                          }
                        }}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs transition-all border border-white/10 active:scale-95"
                      >
                        <ExternalLink className="w-4 h-4" />
                        <span>{t('В браузере')}</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
