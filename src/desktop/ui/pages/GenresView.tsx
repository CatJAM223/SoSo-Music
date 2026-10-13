import { useLocale } from '../../../shared/i18n/useLocale';
import { t, getIntlLocale } from '../../../shared/i18n/locale';
import React, { useEffect, useState, useRef } from 'react';
import { Disc3, Search } from 'lucide-react';
import { Genre, Track, MusicSource } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';
import { CatLoader } from '../components/CatLoader';
import { platformBridge } from '../../../shared/bridge/platformBridge';
import { getGenreArtists } from '../../../shared/services/genreCatalog';

interface GenresViewProps {
  onOpenAddToPlaylist: (track: Track) => void;
  onNavigate: (view: string, data?: any) => void;
}

export const GenresView: React.FC<GenresViewProps> = ({ onOpenAddToPlaylist, onNavigate }) => {
  useLocale();
  const [genres, setGenres] = useState<Genre[]>([]);
  const [selectedGenre, setSelectedGenre] = useState<Genre | null>(null);
  const [genreTracks, setGenreTracks] = useState<Track[]>([]);
  const [loadingGenres, setLoadingGenres] = useState(true);
  const [loadingTracks, setLoadingTracks] = useState(false);
  const [genreQuery, setGenreQuery] = useState('');
  const [source, setSource] = useState<MusicSource>('all');

  useEffect(() => {
    const fetchGenres = async () => {
      setLoadingGenres(true);
      try {
        const res = await platformBridge.getGenres();
        if (res?.data) {
          setGenres(res.data);
        }
      } catch (err) {
        console.error('Error fetching genres:', err);
      } finally {
        setLoadingGenres(false);
      }
    };
    fetchGenres();
  }, []);

  const genreReqIdRef = useRef<number>(0);
  const genreTrackCacheRef = useRef(new Map<number, Track[]>());

  const handleSelectGenre = async (genre: Genre) => {
    const reqId = ++genreReqIdRef.current;
    setSelectedGenre(genre);
    const cached = genreTrackCacheRef.current.get(genre.id);
    setLoadingTracks(!cached);
    setGenreTracks(cached || []);
    if (cached) return;
    try {
      const res = await platformBridge.getGenreTracks(genre.id);
      if (reqId !== genreReqIdRef.current) return;
      setGenreTracks(res?.data || []);
      if (res?.data?.length) genreTrackCacheRef.current.set(genre.id, res.data);
    } catch (e) {
      console.error('Error fetching genre tracks:', e);
    } finally {
      if (reqId === genreReqIdRef.current) {
        setLoadingTracks(false);
      }
    }
  };

  const visibleTracks = genreTracks.filter((track) => source === 'all' || track.source === source);
  const groups = [
    { name: t('Рок и гитары'), ids: [8, 9, 10, 15, 16, 22, 28, 31] },
    { name: t('Электроника'), ids: [1, 4, 5, 11, 12, 13, 14, 20, 21, 23, 27, 29, 32] },
    { name: t('Хип-хоп и R&B'), ids: [2, 3, 17, 18, 30] },
    { name: t('Поп, джаз и другое'), ids: [6, 7, 19, 24, 25, 26] },
  ];
  const visibleGenres = genres.filter((genre) =>
    genre.name
      .toLocaleLowerCase(getIntlLocale())
      .includes(genreQuery.trim().toLocaleLowerCase(getIntlLocale())),
  );
  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <Disc3 className="h-7 w-7 text-soso-brand" />
            <h1 className="text-2xl font-black tracking-tight text-slate-900 dark:text-white md:text-3xl">
              {t('Музыкальные жанры')}
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            {t('Подборки SoundCloud и YouTube Music по музыкальным направлениям')}
          </p>
        </div>
        <label className="relative block w-full lg:max-w-sm">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={genreQuery}
            onChange={(event) => setGenreQuery(event.target.value)}
            placeholder={t('Найти жанр...')}
            aria-label={t('Найти жанр')}
            className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-soso-brand/60 dark:border-zinc-800 dark:bg-zinc-900 dark:text-white dark:placeholder:text-zinc-500"
          />
        </label>
      </div>

      {loadingGenres ? (
        <CatLoader message={t('Загрузка списка жанров...')} size="lg" />
      ) : visibleGenres.length > 0 ? (
        <div className="space-y-6">
          {groups.map((group) => (
            <section key={group.name}>
              {visibleGenres.some((g) => group.ids.includes(g.id)) && (
                <h2 className="mb-3 text-sm font-bold text-slate-500 dark:text-zinc-400">
                  {group.name}
                </h2>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {visibleGenres
                  .filter((g) => group.ids.includes(g.id))
                  .map((g) => {
                    const isSelected = selectedGenre?.id === g.id;
                    return (
                      <button
                        key={g.id}
                        type="button"
                        onClick={() => handleSelectGenre(g)}
                        aria-pressed={isSelected}
                        className={`flex h-24 items-center rounded-xl border bg-slate-100 p-4 text-left transition-colors hover:border-slate-300 hover:bg-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-soso-brand dark:bg-zinc-900 dark:hover:border-zinc-700 dark:hover:bg-zinc-800 ${
                          isSelected ? 'border-soso-brand' : 'border-slate-200 dark:border-zinc-800'
                        }`}
                      >
                        <span className="line-clamp-2 text-sm font-semibold text-slate-800 dark:text-zinc-200">
                          {g.name}
                        </span>
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-12 text-center dark:border-zinc-800">
          <Search className="mx-auto h-8 w-8 text-slate-400 dark:text-zinc-500" />
          <p className="mt-3 text-sm font-bold text-slate-900 dark:text-white">
            {t('Жанр не найден')}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
            {t('Попробуйте другое название или очистите поиск')}
          </p>
          <button
            type="button"
            onClick={() => setGenreQuery('')}
            className="mt-3 text-xs font-bold text-soso-brand hover:underline"
          >
            {t('Показать все жанры')}
          </button>
        </div>
      )}

      {/* Selected Genre Track List */}
      {selectedGenre && (
        <div className="space-y-4 pt-6 border-t border-slate-200 dark:border-zinc-800 animate-fade-in">
          <div className="flex items-center justify-between">
            <h2 className="text-2xl font-bold text-slate-900 dark:text-white">
              {t('Подборка жанра ')}
              <span className="text-soso-brand">«{selectedGenre.name}»</span>
            </h2>
            <span className="text-xs text-slate-600 dark:text-zinc-400 font-mono font-semibold">
              {visibleTracks.length} {t(' треков')}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-zinc-400">
            {getGenreArtists(selectedGenre.id).join(' · ')}
          </p>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('Площадка в жанрах')}>
            {(
              [
                ['all', t('Все площадки')],
                ['soundcloud', 'SoundCloud'],
                ['youtube', 'YouTube Music'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                aria-pressed={source === id}
                onClick={() => setSource(id)}
                className={`rounded-full px-4 py-2 text-xs font-semibold ${source === id ? 'bg-soso-brand text-black' : 'bg-slate-100 dark:bg-zinc-800 text-slate-700 dark:text-zinc-300'}`}
              >
                {label}
                {!loadingTracks && (
                  <span className="ml-2 opacity-60 tabular-nums">
                    {id === 'all'
                      ? genreTracks.length
                      : genreTracks.filter((track) => track.source === id).length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {loadingTracks ? (
            <CatLoader message={t('Загрузка треков жанра...')} size="md" />
          ) : visibleTracks.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500 dark:text-zinc-400">
              {t('На выбранной площадке пока не найдено треков этого жанра.')}
            </p>
          ) : (
            <TrackTable
              tracks={visibleTracks}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              onNavigateToArtist={(artist) => onNavigate('artist', artist)}
              onNavigateToAlbum={(album) => onNavigate('album', album)}
            />
          )}
        </div>
      )}
    </div>
  );
};
