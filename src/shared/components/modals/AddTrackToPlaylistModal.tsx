import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Plus, Check, Music2, Loader2 } from 'lucide-react';
import { Playlist, Track } from '../../types';
import { platformBridge } from '../../bridge/platformBridge';
import { formatTime, resolveTrackCover } from '../../utils/formatters';
import { likedTrackToTrack } from '../../utils/libraryTrack';
import { emitToast } from '../../context/ToastContext';

interface AddTrackToPlaylistModalProps {
  isOpen: boolean;
  playlist: Playlist;
  existingTrackIds: Set<string | number>;
  onTrackAdded?: (track: Track) => void;
  onClose: () => void;
}

export const AddTrackToPlaylistModal: React.FC<AddTrackToPlaylistModalProps> = ({
  isOpen,
  playlist,
  existingTrackIds,
  onTrackAdded,
  onClose,
}) => {
  useLocale();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Track[]>([]);
  const [searching, setSearching] = useState(false);
  const [mode, setMode] = useState<'library' | 'search'>('library');
  const [libraryTracks, setLibraryTracks] = useState<Track[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [addingId, setAddingId] = useState<string | number | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const existingIdsKey = JSON.stringify([...existingTrackIds].map(String).sort());

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setResults([]);
      setMode('library');
      setAddedIds(new Set());
    }
  }, [isOpen, playlist.id]);

  useEffect(() => {
    if (isOpen) setAddedIds((previous) => new Set([...previous, ...JSON.parse(existingIdsKey)]));
  }, [isOpen, existingIdsKey]);

  useEffect(() => {
    if (isOpen) {
      const focusTimer = setTimeout(() => inputRef.current?.focus(), 50);
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        clearTimeout(focusTimer);
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setLoadingLibrary(true);
    platformBridge
      .getLikedTracks()
      .then((tracks) => {
        if (active) setLibraryTracks((tracks || []).map(likedTrackToTrack));
      })
      .catch(() => {
        if (active) {
          setLibraryTracks([]);
          emitToast(t('Не удалось загрузить Мою музыку'), 'error');
        }
      })
      .finally(() => {
        if (active) setLoadingLibrary(false);
      });
    return () => {
      active = false;
    };
  }, [isOpen]);

  // Debounced search
  useEffect(() => {
    const trimmed = query.trim();
    if (!isOpen || mode !== 'search' || trimmed.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }

    setSearching(true);
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const res = await platformBridge.search(trimmed, 20, 'all');
        if (active && res?.data) {
          setResults(res.data);
        }
      } catch (err) {
        console.error('Search error in AddTrackToPlaylistModal:', err);
      } finally {
        if (active) setSearching(false);
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, isOpen, mode]);

  const handleClose = () => {
    onClose();
    setTimeout(() => {
      window.focus();
    }, 50);
  };

  const handleAddTrack = async (track: Track) => {
    if (addedIds.has(String(track.id)) || addingId !== null) return;
    setAddingId(track.id);

    try {
      const coverUrl = resolveTrackCover(track);
      const artistName =
        typeof track.artist === 'object'
          ? track.artist?.name || 'Unknown'
          : String(track.artist || 'Unknown');
      const albumTitle =
        typeof track.album === 'object' ? track.album?.title || '' : String(track.album || '');

      const added = await platformBridge.addTrackToPlaylist(playlist.id, {
        id: track.id,
        deezer_id: track.id,
        title: track.title,
        artist: artistName,
        album: albumTitle,
        cover_url: coverUrl,
        duration: track.duration || 180,
        preview_url: track.preview || '',
        source: track.source,
      } as any);
      if (added === false) throw new Error('Track was not saved');

      setAddedIds((prev) => new Set([...prev, String(track.id)]));
      onTrackAdded?.(track);
    } catch (err) {
      console.error('Failed to add track to playlist:', err);
      emitToast(t('Не удалось добавить трек в плейлист'), 'error');
    } finally {
      setAddingId(null);
    }
  };

  if (!isOpen) return null;
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleResults =
    mode === 'library'
      ? libraryTracks.filter((track) =>
          `${track.title} ${track.artist.name} ${track.album.title}`
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : results;
  const busy = mode === 'library' ? loadingLibrary : searching;

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70 backdrop-blur-md animate-fade-in select-none">
      <div className="absolute inset-0" onClick={handleClose} />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-tracks-title"
        className="relative z-10 w-full sm:max-w-xl bg-white dark:bg-zinc-950 border border-slate-200 dark:border-zinc-800 rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh] animate-fade-in safe-area-pb"
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h2
              id="add-tracks-title"
              className="text-lg font-black text-slate-900 dark:text-white tracking-tight"
            >
              {t('Добавить треки')}
            </h2>
          </div>
          <button
            type="button"
            aria-label={t('Закрыть')}
            onClick={handleClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div
          className="flex gap-1 rounded-xl bg-slate-100 dark:bg-zinc-900 p-1"
          aria-label={t('Источник треков')}
        >
          {(
            [
              ['library', t('Моя музыка')],
              ['search', t('Поиск')],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => {
                setMode(value);
                setQuery('');
                setResults([]);
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${mode === value ? 'bg-white dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs' : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'}`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative flex items-center">
          <Search className="w-4 h-4 text-slate-400 dark:text-zinc-400 absolute left-3.5 pointer-events-none" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={
              mode === 'library'
                ? t('Найти в Моей музыке...')
                : t('Название трека или исполнителя...')
            }
            aria-label={mode === 'library' ? t('Найти в Моей музыке') : t('Найти трек')}
            className="w-full pl-10 pr-10 py-2.5 bg-slate-100 dark:bg-zinc-900/80 border border-slate-200 dark:border-zinc-700/60 rounded-2xl text-xs sm:text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-hidden focus:ring-2 focus:ring-soso-brand/50 transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              className="absolute right-3 p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Results List */}
        <div className="flex-1 overflow-y-auto space-y-1.5 custom-scrollbar pr-1 min-h-[220px] max-h-[380px]">
          {busy ? (
            <div className="py-16 flex flex-col items-center justify-center gap-2 text-slate-400 dark:text-zinc-500">
              <Loader2 className="w-6 h-6 animate-spin text-soso-brand" />
              <span className="text-xs">
                {mode === 'library' ? t('Загрузка Моей музыки...') : t('Поиск треков...')}
              </span>
            </div>
          ) : query.trim().length >= (mode === 'library' ? 1 : 2) && visibleResults.length === 0 ? (
            <div className="py-16 text-center text-slate-400 dark:text-zinc-500 space-y-1">
              <p className="text-sm font-semibold">{t('Ничего не найдено')}</p>
              <p className="text-xs">{t('Попробуйте изменить поисковый запрос')}</p>
            </div>
          ) : visibleResults.length === 0 ? (
            <div className="py-16 text-center text-slate-400 dark:text-zinc-500 space-y-1.5">
              <Music2 className="w-10 h-10 mx-auto opacity-30 text-soso-brand" />
              <p className="text-xs">
                {mode === 'library'
                  ? t('Здесь появятся треки, которые ты лайкнул')
                  : t('Введите название трека или исполнителя')}
              </p>
            </div>
          ) : (
            visibleResults.map((track) => {
              const isAdded = addedIds.has(String(track.id));
              const isAdding = addingId === track.id;
              const cover = resolveTrackCover(track);
              const artistName =
                typeof track.artist === 'object'
                  ? track.artist?.name || 'Unknown'
                  : String(track.artist || 'Unknown');

              return (
                <div
                  key={track.id}
                  className="flex items-center justify-between p-2 rounded-2xl hover:bg-slate-100 dark:hover:bg-zinc-800/60 transition-colors gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0 relative">
                      {cover ? (
                        <img
                          src={cover}
                          alt={track.title}
                          className="w-full h-full object-cover"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = 'none';
                          }}
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-zinc-400">
                          <Music2 className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                        {track.title}
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-zinc-400 truncate">
                        {artistName}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] font-mono text-slate-400 dark:text-zinc-500">
                      {formatTime(track.duration || 180)}
                    </span>
                    <button
                      type="button"
                      disabled={isAdded || addingId !== null}
                      onClick={() => handleAddTrack(track)}
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                        isAdded
                          ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 cursor-default'
                          : 'bg-soso-brand text-black hover:scale-105 active:scale-95 shadow-md shadow-soso-brand/20'
                      }`}
                      title={isAdded ? t('Уже в плейлисте') : t('Добавить в плейлист')}
                      aria-label={`${isAdded ? t('Уже в плейлисте') : t('Добавить')}: ${track.title}`}
                    >
                      {isAdding ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : isAdded ? (
                        <Check className="w-4 h-4" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end pt-2 border-t border-slate-100 dark:border-zinc-800">
          <button
            type="button"
            onClick={handleClose}
            className="px-5 py-2 rounded-xl text-xs font-bold text-slate-700 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors"
          >
            {t('Готово')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
