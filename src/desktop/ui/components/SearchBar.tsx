import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useState, useEffect, useRef, useMemo, useId } from 'react';
import { Search, X, Clock, History, Loader2 } from 'lucide-react';
import type {
  Album,
  Artist,
  AutocompleteSuggestion,
  ListeningHistoryItem,
  MusicSource,
  SearchHistoryItem,
  Track,
} from '../../../shared/types';
import { getSuggestionSearchQuery } from '../../../shared/utils/searchHelper';
import {
  SearchSuggestionsList,
  type SearchSuggestion,
  type SearchSuggestionOption,
} from '../../../shared/components/SearchSuggestionsList';
import { useArtistSearchAlbums } from '../../../shared/hooks/useArtistSearchAlbums';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { platformBridge } from '../../../shared/bridge/platformBridge';
import { mapLikedTracks } from '../../../shared/utils/likedTrackMapping';
import { detectTrackSource } from '../../../shared/utils/formatters';

interface SearchBarProps {
  onSearch: (query: string) => void;
  onPlayTrack?: (track: Track) => void;
  onPlayNext?: (track: Track) => void;
  source?: MusicSource;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string; source?: string }) => void;
  onNavigateToAlbum?: (album: Album) => void;
}

const EMPTY_SUGGESTIONS: AutocompleteSuggestion[] = [];

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  onPlayTrack,
  onPlayNext,
  source = 'all',
  initialQuery = '',
  onQueryChange,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  const [query, setQuery] = useState(initialQuery);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [activeId, setActiveId] = useState<string>();
  const [autocomplete, setAutocomplete] = useState<{
    query: string;
    source: MusicSource;
    suggestions: AutocompleteSuggestion[];
  }>();
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [recentTracks, setRecentTracks] = useState<ListeningHistoryItem[]>([]);
  const [libraryMatches, setLibraryMatches] = useState<{ query: string; tracks: Track[] }>();
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const suggestions =
    autocomplete?.query === query && autocomplete.source === source
      ? autocomplete.suggestions
      : EMPTY_SUGGESTIONS;
  const localQuery = query.trim();
  const artistSuggestions = useMemo(
    () => suggestions.filter((item) => item.type === 'artist'),
    [suggestions],
  );
  const albumArtists = useMemo<Artist[]>(
    () =>
      artistSuggestions.map((item) => ({
        id: item.id,
        name: item.title,
        picture: item.picture,
        source: item.source,
      })),
    [artistSuggestions],
  );
  const noTracks = useMemo<Track[]>(() => [], []);
  const discoveredAlbums = useArtistSearchAlbums(query, albumArtists, noTracks, false, source);
  const albumSuggestions = useMemo(() => {
    const directAlbums = suggestions
      .filter((item) => item.type === 'album')
      .map((item): Album => ({
        id: item.id,
        title: item.title,
        artist_name: item.artist,
        artist: { name: item.artist },
        cover: item.picture || '',
        cover_medium: item.picture || '',
        source: item.source,
      }));
    const seen = new Set<string>();
    return [...directAlbums, ...(artistSuggestions.length ? discoveredAlbums : [])].filter(
      (album) => {
        const key = `${album.artist?.name || album.artist_name || ''}:${album.title}`
          .toLocaleLowerCase()
          .replace(/\s+/g, ' ')
          .trim();
        if (!album.title || seen.has(key)) return false;
        seen.add(key);
        return true;
      },
    );
  }, [suggestions, artistSuggestions, discoveredAlbums]);
  const options = useMemo(() => {
    const optionsById = new Map<string, SearchSuggestionOption>();
    const add = (option: SearchSuggestion) => {
      const { kind, item } = option;
      const recording = 'track' in item ? item.track : undefined;
      const id = `${listId}-${kind}-${item.source ?? 'unknown'}-${recording?.id ?? item.id}`;
      if (!optionsById.has(id)) optionsById.set(id, { ...option, id });
    };
    const addTrack = (item: AutocompleteSuggestion) => {
      if (item.track && item.source === 'youtube' && youtubeDisabled) return;
      add({ kind: 'track', item, hasQueueAction: Boolean(item.track && onPlayNext) });
      if (item.track && onPlayNext) add({ kind: 'next', item });
    };
    if (localQuery.length >= 2) {
      const lowerQuery = localQuery.toLocaleLowerCase();
      const fromHistory: Track[] = recentTracks
        .filter((item) => `${item.title} ${item.artist}`.toLocaleLowerCase().includes(lowerQuery))
        .slice(0, 8)
        .map((item) => ({
          id: item.track_id,
          recordingId: item.recordingId,
          title: item.title,
          artist: { name: item.artist },
          album: { title: item.album || '', cover: item.cover_url || '' },
          duration: item.duration || 0,
          preview: '',
          source: item.source,
        }));
      const fromLibrary = libraryMatches?.query === localQuery ? libraryMatches.tracks : [];
      for (const track of [...fromLibrary, ...fromHistory]) {
        const trackSource = detectTrackSource(track);
        if (source !== 'all' && source !== trackSource) continue;
        addTrack({
          id: track.id,
          title: track.title,
          artist: track.artist.name,
          type: 'track',
          source: trackSource,
          track,
        });
      }
    }
    for (const item of suggestions) {
      if (item.type === 'album') {
        const album = albumSuggestions.find(
          (candidate) => candidate.id === item.id && candidate.source === item.source,
        );
        if (album) add({ kind: 'album', item: album });
      } else if (item.type === 'artist') {
        add({ kind: 'artist', item });
      } else if (!item.track || item.source !== 'youtube' || !youtubeDisabled) {
        addTrack(item);
        if (item.artist && item.artist !== 'SoundCloud' && item.artist !== 'Поиск') {
          add({ kind: 'trackArtist', item });
        }
      }
    }
    albumSuggestions.forEach((item) => add({ kind: 'album', item }));
    return Array.from(optionsById.values());
  }, [
    albumSuggestions,
    listId,
    suggestions,
    youtubeDisabled,
    localQuery,
    libraryMatches,
    recentTracks,
    source,
    onPlayNext,
  ]);
  const suggestionsOpen = isPopupOpen && Boolean(query.trim()) && options.length > 0;
  const historyOpen = isPopupOpen && !query.trim() && history.length > 0;
  const activeOption = suggestionsOpen
    ? options.find((option) => option.id === activeId)
    : undefined;

  useEffect(() => {
    if (activeOption)
      document.getElementById(activeOption.id)?.scrollIntoView({ block: 'nearest' });
  }, [activeOption]);

  // Sync initialQuery
  useEffect(() => {
    setQuery(initialQuery);
    setActiveId(undefined);
  }, [initialQuery]);

  // Fetch search history on mount
  const loadHistory = async () => {
    try {
      if (window.electronAPI?.getSearchHistory) {
        const items = await window.electronAPI.getSearchHistory(10);
        setHistory(items || []);
      }
    } catch (e) {
      console.error('Error loading search history:', e);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  useEffect(() => {
    if (!isPopupOpen || !onPlayTrack) return;
    let current = true;
    void platformBridge
      .getListeningHistory(40, true)
      .then((items) => {
        if (current) setRecentTracks(items || []);
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [isPopupOpen, onPlayTrack]);

  useEffect(() => {
    if (!isPopupOpen || !onPlayTrack || localQuery.length < 2) return;
    let current = true;
    void platformBridge
      .getLibraryPage({ kind: 'tracks', query: localQuery, limit: 8 })
      .then((page) => {
        if (current) setLibraryMatches({ query: localQuery, tracks: mapLikedTracks(page.items) });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [isPopupOpen, localQuery, onPlayTrack]);

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsPopupOpen(false);
        setActiveId(undefined);
      }
    };

    document.addEventListener('pointerdown', handleClickOutside);
    return () => document.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  // Debounced autocomplete fetch
  useEffect(() => {
    if (query.trim().length < 2) {
      setIsLoadingSuggestions(false);
      return;
    }

    let current = true;
    const timer = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        const res: unknown = await window.electronAPI?.getAutocomplete?.(query, source);
        if (!current) return;
        const items = res && typeof res === 'object' && 'data' in res ? res.data : res;
        setAutocomplete({
          query,
          source,
          suggestions: Array.isArray(items) ? items : EMPTY_SUGGESTIONS,
        });
      } catch (e) {
        if (current) console.error('Error fetching autocomplete:', e);
      } finally {
        if (current) setIsLoadingSuggestions(false);
      }
    }, 250);

    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, source]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    executeSearch(query.trim());
  };

  const executeSearch = async (searchQuery: string) => {
    setIsPopupOpen(false);
    setActiveId(undefined);
    onSearch(searchQuery);

    // Add to SQLite search history
    try {
      if (window.electronAPI?.addSearchHistory) {
        await window.electronAPI.addSearchHistory(searchQuery);
        loadHistory();
      }
    } catch (e) {
      console.error('Error adding search history:', e);
    }
  };

  const handleSelectSuggestion = (item: AutocompleteSuggestion, onlyArtist = false) => {
    if (item.type === 'artist' && onNavigateToArtist) {
      setIsPopupOpen(false);
      setActiveId(undefined);
      onNavigateToArtist({ id: item.id, name: item.title, source: item.source });
      return;
    }
    const targetQuery = getSuggestionSearchQuery(item, onlyArtist);
    setQuery(targetQuery);
    executeSearch(targetQuery);
  };

  const handleSelectAlbum = (album: Album) => {
    setIsPopupOpen(false);
    setActiveId(undefined);
    if (onNavigateToAlbum) {
      onNavigateToAlbum(album);
      return;
    }
    const searchQuery = `${album.artist?.name || album.artist_name || ''} ${album.title}`.trim();
    setQuery(searchQuery);
    executeSearch(searchQuery);
  };

  const handleSelectOption = (option: SearchSuggestionOption) => {
    if (option.kind === 'next') {
      if (option.item.track) onPlayNext?.(option.item.track);
    } else if (option.kind === 'track' && option.item.track && onPlayTrack) {
      setIsPopupOpen(false);
      setActiveId(undefined);
      onPlayTrack(option.item.track);
    } else if (option.kind === 'album') handleSelectAlbum(option.item);
    else handleSelectSuggestion(option.item, option.kind === 'trackArtist');
  };

  const handleInputKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Enter' && activeOption) {
      event.preventDefault();
      handleSelectOption(activeOption);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!query.trim() || options.length === 0) return;
      event.preventDefault();
      const index = activeOption ? options.indexOf(activeOption) : -1;
      const next =
        event.key === 'ArrowDown'
          ? Math.min(index + 1, options.length - 1)
          : index < 0
            ? options.length - 1
            : Math.max(index - 1, 0);
      setIsPopupOpen(true);
      setActiveId(options[next].id);
    }
  };

  const handleClearHistory = async (button: HTMLButtonElement) => {
    try {
      if (window.electronAPI?.clearSearchHistory) {
        await window.electronAPI.clearSearchHistory();
        if (document.activeElement === button) inputRef.current?.focus();
        setHistory([]);
      }
    } catch (e) {
      console.error('Error clearing history:', e);
    }
  };

  const handleDeleteHistoryItem = async (button: HTMLButtonElement, id: number) => {
    try {
      if (window.electronAPI?.removeSearchHistoryItem) {
        await window.electronAPI.removeSearchHistoryItem(id);
        if (document.activeElement === button) inputRef.current?.focus();
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (e) {
      console.error('Error removing history item:', e);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative w-full max-w-xl"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setIsPopupOpen(false);
          setActiveId(undefined);
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || (!suggestionsOpen && !historyOpen)) return;
        if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
        event.preventDefault();
        event.stopPropagation();
        inputRef.current?.focus();
        setIsPopupOpen(false);
        setActiveId(undefined);
      }}
    >
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <div className="absolute left-3.5 text-slate-400 dark:text-zinc-400 pointer-events-none flex items-center">
          {isLoadingSuggestions ? (
            <Loader2 className="w-4 h-4 animate-spin text-soso-brand" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </div>

        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={t('Поиск музыки')}
          aria-autocomplete="list"
          aria-expanded={suggestionsOpen}
          maxLength={500}
          aria-controls={suggestionsOpen ? listId : undefined}
          aria-activedescendant={activeOption?.id}
          autoComplete="off"
          value={query}
          onKeyDown={handleInputKeyDown}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsPopupOpen(true);
            setActiveId(undefined);
            onQueryChange?.(e.target.value);
          }}
          onFocus={() => {
            setIsPopupOpen(true);
            loadHistory();
          }}
          placeholder={t('Что хотите послушать? (трек, артист, альбом...)')}
          className="w-full pl-10 pr-10 py-2.5 soso-search-input text-sm placeholder-slate-400 dark:placeholder-zinc-400 shadow-xs"
        />

        {query && (
          <button
            type="button"
            aria-label={t('Очистить поиск')}
            onClick={() => {
              setQuery('');
              setActiveId(undefined);
              inputRef.current?.focus();
              onSearch('');
            }}
            className="absolute right-3.5 text-slate-400 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </form>

      {/* Autocomplete & History Dropdown */}
      {(suggestionsOpen || historyOpen) && (
        <div className="absolute left-0 right-0 top-full mt-2 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-slate-200 dark:border-zinc-700/60 rounded-2xl shadow-2xl max-h-[min(60vh,28rem)] overflow-y-auto z-50 animate-fade-in">
          {/* Autocomplete Suggestions */}
          {suggestionsOpen && (
            <div className="p-2">
              <div className="px-3 py-1 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                {t('Подсказки')}
              </div>
              <SearchSuggestionsList
                listId={listId}
                options={options}
                activeId={activeOption?.id}
                onSelect={handleSelectOption}
              />
            </div>
          )}

          {/* Search History (when query is empty) */}
          {historyOpen && (
            <div className="p-2">
              <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 dark:border-zinc-800">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                  <History className="w-3.5 h-3.5" />
                  <span>{t('История поиска')}</span>
                </div>
                <button
                  type="button"
                  onClick={(event) => handleClearHistory(event.currentTarget)}
                  className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                >
                  {t('Очистить всё')}
                </button>
              </div>

              <div className="pt-1">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between pr-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-sm text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white transition-colors group"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        inputRef.current?.focus();
                        setQuery(item.query);
                        executeSearch(item.query);
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-left"
                    >
                      <Clock
                        aria-hidden="true"
                        className="w-3.5 h-3.5 shrink-0 text-slate-400 dark:text-zinc-500 group-hover:text-soso-brand"
                      />
                      <span className="truncate">{item.query}</span>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleDeleteHistoryItem(e.currentTarget, item.id)}
                      aria-label={t('Удалить из истории')}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-opacity"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
