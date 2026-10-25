import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import React, { useState, useEffect } from 'react';
import { X, Play, Pause } from 'lucide-react';
import { useAudio } from '../context/AudioContext';
import { detectTrackSource } from '../utils/formatters';
import { DEFAULT_COVER_SVG_DATA_URI } from '../utils/placeholder';

interface SnippetModalProps {
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
}

export const SnippetModal: React.FC<SnippetModalProps> = ({ onNavigateToArtist }) => {
  useLocale();
  const {
    snippetTrack,
    isSnippetPlaying,
    snippetProgress,
    seekSnippet,
    stopSnippet,
    toggleSnippetPlay,
  } = useAudio();

  const [isDragging, setIsDragging] = useState(false);
  const [dragProgress, setDragProgress] = useState(0);
  const dragProgressRef = React.useRef(0);

  useEffect(() => {
    dragProgressRef.current = dragProgress;
  }, [dragProgress]);

  // Handle Escape key to close modal
  useEffect(() => {
    if (!snippetTrack) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopSnippet();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [snippetTrack, stopSnippet]);

  // Global release listener for smooth dragging
  useEffect(() => {
    if (!isDragging) return;

    const handleGlobalRelease = () => {
      seekSnippet(dragProgressRef.current);
      setIsDragging(false);
    };

    window.addEventListener('pointerup', handleGlobalRelease);
    window.addEventListener('mouseup', handleGlobalRelease);
    window.addEventListener('touchend', handleGlobalRelease);

    return () => {
      window.removeEventListener('pointerup', handleGlobalRelease);
      window.removeEventListener('mouseup', handleGlobalRelease);
      window.removeEventListener('touchend', handleGlobalRelease);
    };
  }, [isDragging, seekSnippet]);

  // If no snippet track is active, don't show
  if (!snippetTrack) {
    return null;
  }

  const coverUrl =
    snippetTrack.album?.cover_big ||
    snippetTrack.album?.cover_medium ||
    snippetTrack.album?.cover ||
    DEFAULT_COVER_SVG_DATA_URI;

  const currentProgress = isDragging ? dragProgress : snippetProgress;
  const progressPercent = Math.min(100, Math.max(0, currentProgress * 100));
  const currentSec = (currentProgress * 10).toFixed(1);

  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setDragProgress(val);
    dragProgressRef.current = val;
  };

  const handleSeekStart = () => {
    setIsDragging(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in select-none">
      {/* Click outside to close */}
      <div className="absolute inset-0" onClick={stopSnippet} />

      {/* Floating Central Snippet Card */}
      <div className="relative w-full max-w-sm bg-white dark:bg-zinc-900 rounded-3xl border border-slate-200 dark:border-zinc-800 shadow-2xl p-6 flex flex-col items-center text-center space-y-5 animate-scale-in">
        {/* Close button */}
        <button
          onClick={stopSnippet}
          className="absolute top-4 right-4 p-2 rounded-full text-slate-400 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          title={t('Закрыть')}
        >
          <X className="w-5 h-5" />
        </button>

        {/* Album Artwork with Sound Waves */}
        <div className="relative w-44 h-44 rounded-2xl overflow-hidden shadow-2xl border border-black/10 dark:border-white/10 group mt-2">
          <img
            src={coverUrl}
            alt={snippetTrack.title}
            onError={(e) => {
              e.currentTarget.onerror = null;
              e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
            }}
            className="w-full h-full object-cover transform scale-105 group-hover:scale-110 transition-transform duration-500"
          />
          {/* Sound wave overlay */}
          {isSnippetPlaying && (
            <div className="absolute inset-0 bg-linear-to-t from-black/70 via-transparent to-transparent flex items-end justify-center p-3">
              <div className="flex items-end gap-1.5 h-7">
                {[0.4, 0.9, 0.6, 1.0, 0.7, 0.3, 0.8, 0.5, 0.9, 0.4].map((h, i) => (
                  <div
                    key={i}
                    className="w-1.5 bg-purple-400 rounded-full animate-pulse shadow-xs"
                    style={{
                      height: `${Math.round(h * 100)}%`,
                      animationDelay: `${i * 0.1}s`,
                      animationDuration: '0.7s',
                    }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Track Title & Artist */}
        <div className="space-y-1 max-w-xs px-2">
          <h3 className="text-base font-bold text-slate-900 dark:text-white truncate">
            {snippetTrack.title}
          </h3>
          <p
            onClick={() => {
              if (onNavigateToArtist && snippetTrack.artist?.name) {
                stopSnippet();
                const artistName = snippetTrack.artist.name;
                const source =
                  snippetTrack.artist?.source ||
                  snippetTrack.source ||
                  detectTrackSource(snippetTrack);
                const rawTrackId = String(snippetTrack.id || '');
                const isNumericScId =
                  snippetTrack.artist?.id && String(snippetTrack.artist.id).match(/^sc_art_\d+$/);
                const artistId =
                  snippetTrack.artist?.id && !isNumericScId
                    ? snippetTrack.artist.id
                    : rawTrackId.startsWith('sc_') || source === 'soundcloud'
                      ? `sc_art_${artistName.toLowerCase().replace(/\s+/g, '_')}`
                      : rawTrackId.startsWith('yt_') || source === 'youtube'
                        ? `yt_art_${artistName.toLowerCase().replace(/\s+/g, '_')}`
                        : snippetTrack.artist?.id;
                onNavigateToArtist({ id: artistId, name: artistName });
              }
            }}
            className={`text-xs font-semibold text-slate-600 dark:text-zinc-400 truncate ${
              onNavigateToArtist
                ? 'hover:underline cursor-pointer hover:text-slate-950 dark:hover:text-white'
                : ''
            }`}
          >
            {snippetTrack.artist?.name || 'Unknown Artist'}
          </p>
        </div>

        {/* Interactive Seekable Snippet Progress Bar */}
        <div className="w-full space-y-1 px-1">
          <div className="relative w-full h-4 flex items-center group">
            {/* Background track */}
            <div className="w-full bg-slate-200 dark:bg-zinc-800 h-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-linear-to-r from-purple-500 via-pink-500 to-emerald-400 rounded-full smooth-progress"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            {/* Interactive range slider on top */}
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={currentProgress}
              onChange={handleSeekChange}
              onMouseDown={handleSeekStart}
              onTouchStart={handleSeekStart}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
          </div>

          <div className="flex justify-between text-[11px] font-mono text-slate-500 dark:text-zinc-400 px-1">
            <span>{currentSec}s</span>
            <span>10.0s</span>
          </div>
        </div>

        {/* Play/Pause control */}
        <div className="flex items-center gap-3">
          <button
            onClick={toggleSnippetPlay}
            className="w-12 h-12 rounded-full bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center shadow-lg shadow-purple-600/30 transition-all hover:scale-105"
            title={isSnippetPlaying ? t('Пауза') : t('Воспроизвести')}
          >
            {isSnippetPlaying ? (
              <Pause className="w-5 h-5 fill-current" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
};
