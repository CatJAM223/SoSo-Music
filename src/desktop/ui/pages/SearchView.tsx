import { useLocale } from '../../../shared/i18n/useLocale';
import { t, getIntlLocale } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Music, Globe, Users, Clock3 } from 'lucide-react';
import { Artist, MusicSource, SearchHistoryItem, Track } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';
import { SearchBar } from '../components/SearchBar';
import { CatLoader } from '../components/CatLoader';
import { SourceBadge } from '../components/SourceBadge';
import { generateInitialsAvatarUri } from '../../../shared/utils/placeholder';
import { useArtistSearchAlbums } from '../../../shared/hooks/useArtistSearchAlbums';
import { SearchAlbumResults } from '../../../shared/components/SearchAlbumResults';
import { runProgressiveSearch } from '../../../shared/utils/progressiveSearch';
import { platformBridge } from '../../../shared/bridge/platformBridge';
import type { SearchPageState } from '../navigationHistory';

interface SearchViewProps {
  initialQuery?: string;
  initialState?: SearchPageState;
  onStateChange?: (state: SearchPageState) => void;
  onOpenAddToPlaylist: (track: Track) => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: any) => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  initialQuery = '',
  initialState,
  onStateChange,
  onOpenAddToPlaylist,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  const initialStateRef = useRef(initialState);
  const [query, setQuery] = useState(initialState?.query ?? initialQuery);
  const [draft, setDraft] = useState(initialState?.draft ?? initialQuery);
  const [results, setResults] = useState<Track[]>(initialState?.results || []);
  const [artists, setArtists] = useState<Artist[]>(initialState?.artists || []);
  const [loading, setLoading] = useState(Boolean(initialState?.query && !initialState.completed));
  const [completed, setCompleted] = useState(initialState?.completed || false);
  const [selectedSource, setSelectedSource] = useState<MusicSource>(initialState?.source || 'all');
  const [recentQueries, setRecentQueries] = useState<SearchHistoryItem[]>([]);
  const [failedSources, setFailedSources] = useState<MusicSource[]>(
    initialState?.failedSources || [],
  );
  const searchController = useRef<AbortController | null>(null);
  const albums = useArtistSearchAlbums(query, artists, results, true, selectedSource);

  const searchReqIdRef = useRef<number>(0);
  useEffect(
    () => () => {
      searchReqIdRef.current += 1;
      searchController.current?.abort();
    },
    [],
  );
  useEffect(() => {
    onStateChange?.({
      query,
      draft,
      results,
      artists,
      source: selectedSource,
      completed,
      failedSources,
    });
  }, [query, draft, results, artists, selectedSource, completed, failedSources, onStateChange]);

  const loadRecentQueries = useCallback(async () => {
    try {
      const items = await platformBridge.getSearchHistory(6);
      setRecentQueries(items || []);
    } catch {
      setRecentQueries([]);
    }
  }, []);

  useEffect(() => {
    loadRecentQueries();
  }, [loadRecentQueries]);

  const performSearch = useCallback(
    async (searchQuery: string, sourceToUse: MusicSource) => {
      if (!searchQuery.trim()) return;
      const currentReqId = ++searchReqIdRef.current;
      searchController.current?.abort();
      const controller = new AbortController();
      searchController.current = controller;
      setFailedSources([]);
      setLoading(true);
      setCompleted(false);
      setResults([]);
      setArtists([]);
      try {
        if (window.electronAPI) {
          await runProgressiveSearch(
            searchQuery,
            sourceToUse,
            window.electronAPI,
            (snapshot) => {
              if (currentReqId !== searchReqIdRef.current) return;
              setResults(snapshot.tracks);
              setArtists(snapshot.artists);
              setFailedSources(snapshot.failedSources);
              if (snapshot.tracks.length || snapshot.artists.length || !snapshot.pending)
                setLoading(false);
            },
            15000,
            controller.signal,
          );
          if (currentReqId === searchReqIdRef.current) {
            await loadRecentQueries();
          }
        }
      } catch (err) {
        if (currentReqId === searchReqIdRef.current) {
          console.error('Error performing search:', err);
        }
      } finally {
        if (currentReqId === searchReqIdRef.current) {
          setLoading(false);
          setCompleted(true);
        }
      }
    },
    [loadRecentQueries],
  );

  // Completed history entries restore their results without issuing a new search.
  useEffect(() => {
    const restored = initialStateRef.current;
    if (restored?.completed) return;
    const target = restored?.query ?? initialQuery;
    if (target.trim()) void performSearch(target, restored?.source || 'all');
  }, [initialQuery, performSearch]);

  const handleSearchSubmit = (newQuery: string) => {
    setQuery(newQuery);
    setDraft(newQuery);
    if (!newQuery.trim()) {
      searchReqIdRef.current += 1;
      searchController.current?.abort();
      setFailedSources([]);
      setResults([]);
      setArtists([]);
      setLoading(false);
      setCompleted(true);
      return;
    }
    performSearch(newQuery, selectedSource);
  };

  const handleSourceChange = (newSource: MusicSource) => {
    setSelectedSource(newSource);
    if (query.trim()) {
      performSearch(query, newSource);
    }
  };

  const hasResults = results.length > 0 || artists.length > 0 || albums.length > 0;

  return (
    <div className="space-y-3 md:space-y-6 animate-fade-in">
      {/* Search Header */}
      <div className="space-y-2.5 md:space-y-4">
        <h1 className="text-xl md:text-3xl font-black text-slate-900 dark:text-white tracking-tight">
          {t('Поиск музыки')}
        </h1>
        <SearchBar
          onSearch={handleSearchSubmit}
          initialQuery={draft}
          onQueryChange={setDraft}
          onNavigateToArtist={onNavigateToArtist}
          onNavigateToAlbum={onNavigateToAlbum}
        />

        {/* Source Selector */}
        <div className="flex items-center gap-1.5 md:gap-2 pt-0.5 overflow-x-auto scrollbar-none pb-0.5">
          <button
            onClick={() => handleSourceChange('all')}
            className={`flex items-center gap-1 px-2.5 py-1 md:px-3.5 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold transition-all shadow-sm flex-shrink-0 ${
              selectedSource === 'all'
                ? 'bg-soso-brand text-black shadow-md shadow-soso-brand/20 ring-1 ring-soso-brand'
                : 'bg-white dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white border border-slate-200 dark:border-zinc-700/60'
            }`}
          >
            <Globe className="w-3 h-3 md:w-3.5 md:h-3.5" />
            <span>{t('Все источники')}</span>
          </button>

          <button
            onClick={() => handleSourceChange('youtube')}
            className={`flex items-center gap-1 px-2.5 py-1 md:px-3.5 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold transition-all shadow-sm flex-shrink-0 ${
              selectedSource === 'youtube'
                ? 'bg-rose-600 text-white shadow-md shadow-rose-600/25 ring-1 ring-rose-500'
                : 'bg-white dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 hover:text-rose-500 dark:hover:text-rose-400 border border-slate-200 dark:border-zinc-700/60'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
            <span>YouTube Music</span>
          </button>

          <button
            onClick={() => handleSourceChange('soundcloud')}
            className={`flex items-center gap-1 px-2.5 py-1 md:px-3.5 md:py-1.5 rounded-full text-[11px] md:text-xs font-bold transition-all shadow-sm flex-shrink-0 ${
              selectedSource === 'soundcloud'
                ? 'bg-amber-500 text-black shadow-md shadow-amber-500/25 ring-1 ring-amber-500'
                : 'bg-white dark:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 hover:text-amber-500 dark:hover:text-amber-400 border border-slate-200 dark:border-zinc-700/60'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500"></span>
            <span>SoundCloud</span>
          </button>
        </div>
      </div>

      {/* Search Results */}
      <div>
        {failedSources.length > 0 && (
          <div
            role="status"
            className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/30 p-3 text-sm"
          >
            <span>
              {t('Не удалось получить все результаты. Источники: ')}
              {failedSources
                .map((source) => (source === 'soundcloud' ? 'SoundCloud' : 'YouTube Music'))
                .join(', ')}
            </span>
            <button
              type="button"
              className="font-semibold text-soso-brand"
              onClick={() => void performSearch(query, selectedSource)}
            >
              {t('Повторить поиск')}
            </button>
          </div>
        )}
        {loading ? (
          <CatLoader message={t('Ищем исполнителей и треки во всех источниках...')} />
        ) : hasResults ? (
          <div className="space-y-6">
            {/* Artists Section (Rendered First) */}
            {artists.length > 0 && (
              <div className="space-y-3 pt-1">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-soso-brand" />
                    <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                      {t('Исполнители')}
                    </h2>
                  </div>
                  <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono font-medium">
                    {artists.length} {t(' найдено')}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {artists.map((artist) => {
                    const artistPic =
                      artist.picture_big ||
                      artist.picture_medium ||
                      artist.picture ||
                      generateInitialsAvatarUri(artist.name);

                    return (
                      <div
                        {...youtubeDisabledProps(artist, youtubeDisabled)}
                        key={artist.id}
                        onClick={() =>
                          onNavigateToArtist &&
                          onNavigateToArtist({ id: artist.id, name: artist.name })
                        }
                        className="group relative flex flex-col items-center p-3.5 rounded-2xl bg-white/70 dark:bg-zinc-900/70 hover:bg-slate-100 dark:hover:bg-zinc-800/90 border border-slate-200/80 dark:border-zinc-800/80 hover:border-soso-brand/40 dark:hover:border-soso-brand/40 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md text-center"
                      >
                        {/* Avatar */}
                        <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden mb-3 shadow-md group-hover:scale-105 transition-transform duration-200 bg-slate-200 dark:bg-zinc-800 ring-2 ring-transparent group-hover:ring-soso-brand/50">
                          <img
                            src={artistPic}
                            alt={artist.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLElement).style.display = 'none';
                            }}
                          />
                        </div>

                        {/* Name */}
                        <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate max-w-full group-hover:text-soso-brand transition-colors">
                          {artist.name}
                        </h3>

                        {/* Subtitle / Followers */}
                        <div className="text-[11px] font-semibold text-slate-500 dark:text-zinc-400 mt-0.5 truncate max-w-full">
                          {artist.nb_fan ? (
                            <span>
                              {artist.nb_fan.toLocaleString(getIntlLocale())} {t(' слушателей')}
                            </span>
                          ) : artist.nb_album ? (
                            <span>
                              {artist.nb_album} {t(' релизов')}
                            </span>
                          ) : (
                            <span>{t('Исполнитель')}</span>
                          )}
                        </div>

                        {/* Source Badge */}
                        <div className="mt-2">
                          <SourceBadge source={artist.source || 'soundcloud'} size="sm" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <SearchAlbumResults albums={albums} onOpenAlbum={onNavigateToAlbum} />

            {/* Tracks Section */}
            {results.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-600 dark:text-zinc-400">
                  <div className="flex items-center gap-2">
                    <Music className="w-4 h-4 text-soso-brand" />
                    <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                      {t('Треки')}
                    </h2>
                  </div>
                  <span className="font-mono font-semibold">
                    {results.length} {t(' треков')}
                  </span>
                </div>
                <TrackTable
                  tracks={results}
                  onOpenAddToPlaylist={onOpenAddToPlaylist}
                  onNavigateToArtist={onNavigateToArtist}
                  onNavigateToAlbum={onNavigateToAlbum}
                />
              </div>
            )}
          </div>
        ) : query.trim() ? (
          failedSources.length === 0 && (
            <div className="py-20 text-center text-slate-500 dark:text-zinc-400 space-y-2">
              <Music className="w-10 h-10 mx-auto opacity-30" />
              <p className="text-base font-semibold text-slate-800 dark:text-zinc-200">
                {t('Ничего не найдено')}
              </p>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('Попробуйте переключить источник поиска или изменить запрос')}
              </p>
            </div>
          )
        ) : (
          <div className="space-y-4 py-3 animate-fade-in">
            {recentQueries.length > 0 && (
              <section className="space-y-2.5">
                <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-zinc-300">
                  <Clock3 className="h-4 w-4 text-slate-400" />
                  <h2>{t('Недавние')}</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recentQueries.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSearchSubmit(item.query)}
                      className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-600 transition-colors hover:border-soso-brand/50 hover:text-slate-900 dark:border-zinc-800 dark:bg-zinc-900/50 dark:text-zinc-400 dark:hover:text-white"
                    >
                      <span className="max-w-56 truncate">{item.query}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {recentQueries.length === 0 && (
              <p className="py-8 text-sm text-slate-500 dark:text-zinc-500">
                {t('Найдите трек, исполнителя или альбом')}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
