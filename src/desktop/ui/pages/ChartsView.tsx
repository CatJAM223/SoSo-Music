import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useEffect, useState } from 'react';
import { Play, Pause, Music, AlertCircle, RefreshCw } from 'lucide-react';
import { Album, Track } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';
import { useAudioControls, useAudioState } from '../../../shared/context/AudioContext';
import { CatLoader } from '../components/CatLoader';
import {
  CHART_REGIONS,
  CHART_REGION_STORAGE_KEY,
  isChartRegion,
  type ChartRegion,
} from '../../../shared/utils/chartRegions';
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
  const [region, setRegion] = useState<ChartRegion>(() => {
    try {
      const saved = localStorage.getItem(CHART_REGION_STORAGE_KEY);
      return isChartRegion(saved) ? saved : 'GLOBAL';
    } catch {
      return 'GLOBAL';
    }
  });

  useEffect(() => {
    let isMounted = true;

    const loadCharts = async () => {
      setLoading(true);
      setHasLoadError(false);
      setTracks([]);
      try {
        const chartData = await platformBridge.getCharts(region);
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
  }, [region, refreshToken]);

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
        </div>

        {/* Play All Button */}
        <div className="flex items-center gap-3 self-start md:self-auto flex-wrap sm:flex-nowrap shrink-0">
          <select
            value={region}
            aria-label={t('Регион чарта')}
            onChange={(event) => {
              const next = event.target.value;
              if (!isChartRegion(next)) return;
              setRegion(next);
              try {
                localStorage.setItem(CHART_REGION_STORAGE_KEY, next);
              } catch {}
            }}
            className="max-w-52 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-800 outline-hidden focus-visible:ring-2 focus-visible:ring-soso-brand dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"
          >
            {CHART_REGIONS.map((item) => (
              <option key={item.code} value={item.code}>
                {t(item.label)}
              </option>
            ))}
          </select>
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
          showChartRanks
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
            {t('YouTube Music не вернул треки. Попробуйте загрузить чарт ещё раз.')}
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
