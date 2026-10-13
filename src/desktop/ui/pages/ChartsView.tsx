import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useEffect, useState } from 'react';
import { Play, Pause, Music, AlertCircle, RefreshCw } from 'lucide-react';
import { Album, Track } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';
import { useAudioControls, useAudioState } from '../../../shared/context/AudioContext';
import { CatLoader } from '../components/CatLoader';
import { platformBridge } from '../../../shared/bridge/platformBridge';

interface ChartsViewProps {
  onOpenAddToPlaylist: (track: Track) => void;
  onNavigateToArtist: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: Album) => void;
}

export const ChartsView: React.FC<ChartsViewProps> = ({
  onOpenAddToPlaylist,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const { playTrack, togglePlay } = useAudioControls();
  const { currentTrack, isPlaying } = useAudioState();
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [hasLoadError, setHasLoadError] = useState<boolean>(false);
  const [refreshToken, setRefreshToken] = useState<number>(0);
  const [chartSource, setChartSource] = useState<'all' | 'youtube' | 'soundcloud'>('all');

  useEffect(() => {
    let isMounted = true;

    const loadCharts = async () => {
      setLoading(true);
      setHasLoadError(false);
      setTracks([]);
      try {
        const chartData = await platformBridge.getCharts(chartSource);
        if (isMounted) {
          const nextTracks = chartData?.tracks?.data || [];
          setTracks(nextTracks);
          setHasLoadError(false);
        }
      } catch (e) {
        console.error('Failed to load charts:', e);
        if (isMounted) {
          setTracks([]);
          setHasLoadError(true);
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    loadCharts();

    return () => {
      isMounted = false;
    };
  }, [chartSource, refreshToken]);

  const isPlayingChart =
    currentTrack && tracks.some((t) => String(t.id) === String(currentTrack.id)) && isPlaying;

  const handlePlayAll = () => {
    if (tracks.length === 0) return;
    if (isPlayingChart) {
      togglePlay();
    } else {
      playTrack(tracks[0], tracks);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in pb-12">
      {/* Clean Minimalist Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 md:gap-4 mb-2">
        <div>
          <h1 className="text-xl md:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
            {t('Чарты')}
          </h1>
          <p className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">
            {chartSource === 'all'
              ? t('Популярные треки YouTube Music и SoundCloud')
              : chartSource === 'youtube'
                ? t('Популярные треки YouTube Music')
                : t('Популярные треки SoundCloud')}
          </p>
        </div>

        {/* Source Switcher & Play All Button */}
        <div className="flex items-center gap-3 self-start md:self-auto flex-wrap sm:flex-nowrap shrink-0">
          <div className="flex items-center p-1 bg-slate-200/80 dark:bg-zinc-800/80 rounded-2xl border border-slate-300/50 dark:border-zinc-700/50 shrink-0">
            <button
              onClick={() => setChartSource('all')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                chartSource === 'all'
                  ? 'bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-sm font-black'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              {t('Все источники')}
            </button>
            <button
              onClick={() => setChartSource('youtube')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                chartSource === 'youtube'
                  ? 'bg-red-600 text-white shadow-sm font-black'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-red-500'
              }`}
            >
              YouTube Music
            </button>
            <button
              onClick={() => setChartSource('soundcloud')}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
                chartSource === 'soundcloud'
                  ? 'bg-amber-500 text-black shadow-sm font-black'
                  : 'text-slate-600 dark:text-zinc-400 hover:text-amber-500'
              }`}
            >
              SoundCloud
            </button>
          </div>

          {tracks.length > 0 && (
            <button
              onClick={handlePlayAll}
              className={`flex items-center justify-center gap-2 px-4 py-2 md:px-5 md:py-2.5 rounded-full font-black text-xs md:text-sm transition-all shadow-md active:scale-95 shrink-0 ${
                isPlayingChart
                  ? 'bg-soso-brand text-black ring-4 ring-soso-brand/20'
                  : 'bg-soso-brand hover:bg-[#1ed760] text-black hover:scale-105'
              }`}
            >
              {isPlayingChart ? (
                <>
                  <Pause className="w-4 h-4 fill-current" />
                  <span>{t('Пауза')}</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  <span>
                    {t('Слушать всё (')}
                    {tracks.length})
                  </span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Chart Content */}
      {loading ? (
        <CatLoader message={t('Загружаем чарты...')} size="lg" className="py-24" />
      ) : tracks.length > 0 ? (
        <TrackTable
          tracks={tracks}
          onOpenAddToPlaylist={onOpenAddToPlaylist}
          onNavigateToArtist={onNavigateToArtist}
          onNavigateToAlbum={onNavigateToAlbum}
        />
      ) : (
        <div className="mx-auto flex min-h-72 max-w-2xl flex-col items-center justify-center rounded-3xl border border-slate-200 bg-white/70 px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900/60">
          <div
            className={`mb-4 flex h-14 w-14 items-center justify-center rounded-2xl ${hasLoadError ? 'bg-amber-500/10 text-amber-500' : 'bg-soso-brand/10 text-soso-brand'}`}
          >
            {hasLoadError ? <AlertCircle className="h-7 w-7" /> : <Music className="h-7 w-7" />}
          </div>
          <p className="text-base font-bold text-slate-900 dark:text-white">
            {hasLoadError ? t('Не удалось загрузить чарты') : t('Источник не вернул треки')}
          </p>
          <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-zinc-400">
            {t(
              'Это может быть пустой чарт или сбой соединения. Попробуйте ещё раз или выберите другой источник.',
            )}
          </p>
          <button
            type="button"
            onClick={() => setRefreshToken((token) => token + 1)}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-soso-brand px-4 py-2.5 text-sm font-bold text-black transition-colors hover:bg-soso-brand/90"
          >
            <RefreshCw className="h-4 w-4" />
            <span>{t('Повторить загрузку')}</span>
          </button>
        </div>
      )}
    </div>
  );
};
