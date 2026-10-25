import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Search, X, Clock, History, Loader2 } from 'lucide-react';
import type {
  Album,
  Artist,
  AutocompleteSuggestion,
  SearchHistoryItem,
  Track,
} from '../../../shared/types';
import { getSuggestionSearchQuery } from '../../../shared/utils/searchHelper';
import { SearchSuggestionsList } from '../../../shared/components/SearchSuggestionsList';
import { useArtistSearchAlbums } from '../../../shared/hooks/useArtistSearchAlbums';

interface SearchBarProps {
  onSearch: (query: string) => void;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string; source?: string }) => void;
  onNavigateToAlbum?: (album: Album) => void;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  initialQuery = '',
  onQueryChange,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const [query, setQuery] = useState(initialQuery);
  const [isFocused, setIsFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<AutocompleteSuggestion[]>([]);
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);
  const suggestionRequestRef = useRef(0);
  const artistSuggestions = useMemo(
    () => suggestions.filter((item) => item.type === 'artist'),
    [suggestions],
  );
  const trackSuggestions = useMemo(
    () => suggestions.filter((item) => item.type === 'track'),
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
  const discoveredAlbums = useArtistSearchAlbums(query, albumArtists, noTracks);
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
    return [...directAlbums, ...discoveredAlbums].filter((album) => {
      const key = `${album.artist?.name || album.artist_name || ''}:${album.title}`
        .toLocaleLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
      if (!album.title || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [suggestions, discoveredAlbums]);

  // Sync initialQuery
  useEffect(() => {
    setQuery(initialQuery);
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

  // Handle outside click to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsFocused(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced autocomplete fetch
  useEffect(() => {
    const requestId = ++suggestionRequestRef.current;
    if (!query.trim() || query.length < 2) {
      setSuggestions([]);
      setIsLoadingSuggestions(false);
      return;
    }

    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoadingSuggestions(true);
      try {
        if (window.electronAPI?.getAutocomplete) {
          const res = await window.electronAPI.getAutocomplete(query);
          if (requestId !== suggestionRequestRef.current) return;
          if (Array.isArray(res)) {
            setSuggestions(res);
          } else if (res && Array.isArray((res as any).data)) {
            setSuggestions((res as any).data);
          }
        }
      } catch (e) {
        if (requestId === suggestionRequestRef.current)
          console.error('Error fetching autocomplete:', e);
      } finally {
        if (requestId === suggestionRequestRef.current) setIsLoadingSuggestions(false);
      }
    }, 250);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [query]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    executeSearch(query.trim());
  };

  const executeSearch = async (searchQuery: string) => {
    setIsFocused(false);
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
      setIsFocused(false);
      onNavigateToArtist({ id: item.id, name: item.title, source: item.source });
      return;
    }
    const targetQuery = getSuggestionSearchQuery(item, onlyArtist);
    setQuery(targetQuery);
    executeSearch(targetQuery);
  };

  const handleSelectAlbum = (album: Album) => {
    setIsFocused(false);
    if (onNavigateToAlbum) {
      onNavigateToAlbum(album);
      return;
    }
    const searchQuery = `${album.artist?.name || album.artist_name || ''} ${album.title}`.trim();
    setQuery(searchQuery);
    executeSearch(searchQuery);
  };

  const handleClearHistory = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      if (window.electronAPI?.clearSearchHistory) {
        await window.electronAPI.clearSearchHistory();
        setHistory([]);
      }
    } catch (e) {
      console.error('Error clearing history:', e);
    }
  };

  const handleDeleteHistoryItem = async (e: React.MouseEvent, id: number) => {
    e.stopPropagation();
    try {
      if (window.electronAPI?.removeSearchHistoryItem) {
        await window.electronAPI.removeSearchHistoryItem(id);
        setHistory((prev) => prev.filter((item) => item.id !== id));
      }
    } catch (e) {
      console.error('Error removing history item:', e);
    }
  };

  return (
    <div ref={containerRef} className="relative w-full max-w-xl">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <div className="absolute left-3.5 text-slate-400 dark:text-zinc-400 pointer-events-none flex items-center">
          {isLoadingSuggestions ? (
            <Loader2 className="w-4 h-4 animate-spin text-soso-brand" />
          ) : (
            <Search className="w-4 h-4" />
          )}
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            onQueryChange?.(e.target.value);
          }}
          onFocus={() => {
            setIsFocused(true);
            loadHistory();
          }}
          placeholder={t('Что хотите послушать? (трек, артист, альбом...)')}
          className="w-full pl-10 pr-10 py-2.5 soso-search-input text-sm placeholder-slate-400 dark:placeholder-zinc-400 shadow-xs"
        />

        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setSuggestions([]);
              onSearch('');
            }}
            className="absolute right-3.5 text-slate-400 hover:text-slate-900 dark:text-zinc-400 dark:hover:text-white p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-zinc-700 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </form>

      {/* Autocomplete & History Dropdown */}
      {isFocused &&
        (suggestions.length > 0 ||
          albumSuggestions.length > 0 ||
          (query.trim().length === 0 && history.length > 0)) && (
          <div className="absolute left-0 right-0 top-full mt-2 bg-white/95 dark:bg-[#18181b]/95 backdrop-blur-md border border-slate-200 dark:border-zinc-700/60 rounded-2xl shadow-2xl overflow-hidden z-50 animate-fade-in">
            {/* Autocomplete Suggestions */}
            {(suggestions.length > 0 || albumSuggestions.length > 0) && (
              <div className="p-2">
                <div className="px-3 py-1 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                  {t('Подсказки')}
                </div>
                <SearchSuggestionsList
                  artists={artistSuggestions}
                  albums={albumSuggestions}
                  tracks={trackSuggestions}
                  onSelectSuggestion={handleSelectSuggestion}
                  onSelectAlbum={handleSelectAlbum}
                />
              </div>
            )}

            {/* Search History (when query is empty) */}
            {query.trim().length === 0 && history.length > 0 && (
              <div className="p-2">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-100 dark:border-zinc-800">
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400 dark:text-zinc-500 uppercase tracking-wider">
                    <History className="w-3.5 h-3.5" />
                    <span>{t('История поиска')}</span>
                  </div>
                  <button
                    onClick={handleClearHistory}
                    className="text-[11px] text-slate-400 hover:text-red-500 transition-colors"
                  >
                    {t('Очистить всё')}
                  </button>
                </div>

                <div className="pt-1">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => {
                        setQuery(item.query);
                        executeSearch(item.query);
                      }}
                      className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 cursor-pointer text-sm text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white transition-colors group"
                    >
                      <div className="flex items-center gap-2.5 truncate">
                        <Clock className="w-3.5 h-3.5 text-slate-400 dark:text-zinc-500 group-hover:text-soso-brand" />
                        <span className="truncate">{item.query}</span>
                      </div>
                      <button
                        onClick={(e) => handleDeleteHistoryItem(e, item.id)}
                        aria-label={t('Удалить из истории')}
                        className="opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 transition-opacity"
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
