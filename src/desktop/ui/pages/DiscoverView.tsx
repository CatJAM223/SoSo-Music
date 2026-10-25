import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React, { useEffect, useState, useCallback } from 'react';
import { Play, Pause, Heart, Disc3, ArrowRight, Music2, Loader2 } from 'lucide-react';
import { Album, LikedTrack, SavedAlbum, Track, WaveMood } from '../../../shared/types';
import { useAudioState, useAudioControls } from '../../../shared/context/AudioContext';
import { CatLoader } from '../components/CatLoader';
import { detectTrackSource } from '../../../shared/utils/formatters';
import { DEFAULT_COVER_SVG_DATA_URI } from '../../../shared/utils/placeholder';
import { useDailyRecommendations } from '../hooks/useDailyRecommendations';
import { WaveControl } from '../components/WaveControl';

interface DiscoverViewProps {
  onNavigate: (view: string, data?: any) => void;
  onNavigateToArtist: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: Album) => void;
}

const formatTrackCount = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return t('{0} треков', count);
  if (mod10 === 1) return t('{0} трек', count);
  if (mod10 >= 2 && mod10 <= 4) return t('{0} трека', count);
  return t('{0} треков', count);
};

const formatAlbumCount = (count: number) => {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod100 >= 11 && mod100 <= 19) return t('{0} альбомов', count);
  if (mod10 === 1) return t('{0} альбом', count);
  if (mod10 >= 2 && mod10 <= 4) return t('{0} альбома', count);
  return t('{0} альбомов', count);
};

export const DiscoverView: React.FC<DiscoverViewProps> = ({
  onNavigate,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const {
    currentTrack,
    isPlaying,
    isWaveActive,
    isWaveStarting,
    waveMood,
    waveSource,
    isLoadingTrack,
    likedTrackIds,
    dislikedTrackIds,
  } = useAudioState();
  const { playTrack, togglePlay, stopWave, startWave, setWaveSource, toggleLike } =
    useAudioControls();

  const youtubeDisabled = useYouTubeAvailability();
  const daily = useDailyRecommendations(dislikedTrackIds);
  const recommendedTracks = daily.tracks.filter((track) => !dislikedTrackIds.has(String(track.id)));
  const [likedTracks, setLikedTracks] = useState<LikedTrack[]>([]);
  const [savedAlbums, setSavedAlbums] = useState<SavedAlbum[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedMood, setSelectedMood] = useState<WaveMood>('default');
  const [trendingTracks, setTrendingTracks] = useState<Track[]>([]);
  const [loadingTrending, setLoadingTrending] = useState<boolean>(false);

  const loadUserData = useCallback(async () => {
    try {
      if (window.electronAPI?.getLikedTracks && window.electronAPI?.getSavedAlbums) {
        const [likes, albums] = await Promise.all([
          window.electronAPI.getLikedTracks(),
          window.electronAPI.getSavedAlbums(),
        ]);
        setLikedTracks(likes || []);
        setSavedAlbums(albums || []);

        // Load trending tracks only for new/empty users to fill the page
        if ((!likes || likes.length === 0) && window.electronAPI?.getCharts) {
          setLoadingTrending(true);
          window.electronAPI
            .getCharts()
            .then((chartsData: any) => {
              const tracks: Track[] = chartsData?.tracks?.data || [];
              setTrendingTracks(tracks.slice(0, 8));
            })
            .catch(() => {})
            .finally(() => setLoadingTrending(false));
        }
      }
    } catch (e) {
      console.error('Failed to load user home data:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadUserData();
  }, [loadUserData, likedTrackIds]);

  const handleMoodSelect = (mood: WaveMood) => {
    setSelectedMood(mood);
    startWave(mood);
  };

  const handleWaveToggle = () => {
    if (isWaveStarting) {
      stopWave();
    } else if (isWaveActive) {
      togglePlay();
    } else {
      startWave(selectedMood);
    }
  };

  const handlePlayLikedTrack = (liked: LikedTrack) => {
    const trackObj: Track = {
      id: liked.deezer_id,
      title: liked.title,
      artist: { name: liked.artist },
      album: {
        id: 0,
        title: liked.album || '',
        cover: liked.cover_url,
        cover_medium: liked.cover_url,
        cover_big: liked.cover_url,
      },
      duration: liked.duration,
      preview: liked.preview_url,
      source: detectTrackSource(liked),
    };

    const queueList: Track[] = likedTracks.map((l) => ({
      id: l.deezer_id,
      title: l.title,
      artist: { name: l.artist },
      album: {
        id: 0,
        title: l.album || '',
        cover: l.cover_url,
        cover_medium: l.cover_url,
        cover_big: l.cover_url,
      },
      duration: l.duration,
      preview: l.preview_url,
      source: detectTrackSource(l),
    }));

    playTrack(trackObj, queueList);
  };

  const handlePlaySavedAlbum = async (album: SavedAlbum) => {
    try {
      if (window.electronAPI?.getAlbumTracks) {
        const tracks = await window.electronAPI.getAlbumTracks(album.id);
        if (tracks && tracks.length > 0) {
          playTrack(tracks[0], tracks);
        }
      }
    } catch (e) {
      console.error('Error playing saved album:', e);
    }
  };

  if (loading) {
    return <CatLoader message={t('Загружаем Главную...')} size="lg" className="py-28" />;
  }

  const isWavePlayingNow = isWaveActive && isPlaying;
  const isWaveLoading = isWaveStarting || (isWaveActive && isLoadingTrack);

  return (
    <div className="space-y-4 md:space-y-8 animate-fade-in pb-12 select-none">
      <div className="wave-hero relative z-20 py-4 text-slate-900 dark:text-white sm:py-5">
        <WaveControl
          mood={isWaveActive ? waveMood : selectedMood}
          source={waveSource}
          onSelectSource={setWaveSource}
          isActive={isWaveActive}
          isPlaying={isWavePlayingNow}
          isLoading={isWaveLoading}
          isStarting={isWaveStarting}
          onToggle={handleWaveToggle}
          onSelectMood={handleMoodSelect}
          onReset={() => startWave(isWaveActive ? waveMood : selectedMood)}
        />
      </div>

      <section aria-labelledby="daily-recommendations-title" className="space-y-4">
        <div className="flex items-baseline justify-between gap-3">
          <h2
            id="daily-recommendations-title"
            className="text-lg font-bold text-slate-900 dark:text-white"
          >
            {t('Рекомендуемые')}
          </h2>
          <span className="text-xs text-slate-500 dark:text-zinc-400">
            {t('Обновляются каждый день')}
          </span>
        </div>
        {daily.loading ? (
          <div
            className="flex items-center gap-2 py-8 text-sm text-slate-500 dark:text-zinc-400"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('Подбираем треки…')}
          </div>
        ) : daily.failed ? (
          <div className="flex items-center gap-3 py-5 text-sm text-slate-500 dark:text-zinc-400">
            <span>{t('Не удалось загрузить подборку.')}</span>
            <button onClick={() => void daily.retry()} className="text-soso-brand hover:underline">
              {t('Повторить')}
            </button>
          </div>
        ) : recommendedTracks.length === 0 ? (
          <p className="py-5 text-sm text-slate-500 dark:text-zinc-400">
            {t('Слушайте музыку и отмечайте любимые треки — здесь появятся рекомендации.')}
          </p>
        ) : (
          <div className="grid grid-cols-[repeat(5,minmax(140px,1fr))] gap-4 overflow-x-auto pb-2">
            {recommendedTracks.map((track) => {
              const active = String(currentTrack?.id) === String(track.id);
              const cover =
                track.album?.cover_medium ||
                track.album?.cover ||
                track.album?.cover_big ||
                DEFAULT_COVER_SVG_DATA_URI;
              return (
                <article
                  {...youtubeDisabledProps(track, youtubeDisabled)}
                  key={track.id}
                  className="min-w-0 rounded-xl border border-slate-200 bg-white/50 p-3 dark:border-white/10 dark:bg-zinc-900/60"
                >
                  <button
                    type="button"
                    onClick={() => (active ? togglePlay() : playTrack(track, recommendedTracks))}
                    aria-label={
                      (active && isPlaying ? t('Приостановить: ') : t('Слушать: ')) + track.title
                    }
                    className="group relative mb-3 block aspect-square w-full overflow-hidden rounded-lg"
                  >
                    <img
                      src={cover}
                      alt=""
                      loading="lazy"
                      className="h-full w-full object-cover"
                      onError={(event) => {
                        event.currentTarget.onerror = null;
                        event.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
                      }}
                    />
                    <span className="absolute bottom-2 right-2 flex h-9 w-9 items-center justify-center rounded-full bg-soso-brand text-black shadow-lg transition-transform group-hover:scale-110">
                      {active && isLoadingTrack ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : active && isPlaying ? (
                        <Pause className="h-4 w-4 fill-current" />
                      ) : (
                        <Play className="ml-0.5 h-4 w-4 fill-current" />
                      )}
                    </span>
                  </button>
                  <p
                    className="truncate text-sm font-semibold text-slate-900 dark:text-white"
                    title={track.title}
                  >
                    {track.title}
                  </p>
                  <button
                    onClick={() => onNavigateToArtist(track.artist)}
                    className="mt-1 block max-w-full truncate text-xs text-slate-500 hover:underline dark:text-zinc-400"
                    title={track.artist.name}
                  >
                    {track.artist.name}
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {/* 🔥 СЕЙЧАС В ТРЕНДЕ — показывается только для новых пользователей с пустой коллекцией */}
      {(trendingTracks.length > 0 || loadingTrending) && likedTracks.length === 0 && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight">
                {t('Сейчас в тренде')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium mt-0.5">
                {t('Топ треков прямо сейчас')}
              </p>
            </div>
            <button
              onClick={() => onNavigate('charts')}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-zinc-400 hover:text-soso-brand transition-colors px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800/60"
            >
              <span>{t('Все чарты')}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {loadingTrending ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[...Array(8)].map((_, i) => (
                <div
                  key={i}
                  className="bg-slate-100 dark:bg-zinc-800/50 rounded-2xl aspect-square animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {trendingTracks.map((track) => {
                const isCurrent = currentTrack && String(currentTrack.id) === String(track.id);
                const isTrackPlaying = isCurrent && isPlaying;
                const coverSrc =
                  track.album?.cover_big ||
                  track.album?.cover_medium ||
                  track.album?.cover ||
                  DEFAULT_COVER_SVG_DATA_URI;

                return (
                  <div
                    {...youtubeDisabledProps(track, youtubeDisabled)}
                    key={track.id}
                    onClick={() => playTrack(track, trendingTracks)}
                    className={`group relative rounded-2xl overflow-hidden aspect-square cursor-pointer shadow-md hover:shadow-xl transition-all duration-200 hover:scale-[1.03] ${
                      isCurrent
                        ? 'ring-2 ring-soso-brand ring-offset-2 ring-offset-slate-100 dark:ring-offset-zinc-900'
                        : ''
                    }`}
                  >
                    <img
                      src={coverSrc}
                      alt={track.title}
                      className="w-full h-full object-cover"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
                      }}
                    />
                    {/* Gradient overlay */}
                    <div className="absolute inset-0 bg-linear-to-t from-black/80 via-black/20 to-transparent" />

                    {/* Play/Soundwave indicator */}
                    <div className="absolute top-2 right-2">
                      {isTrackPlaying ? (
                        <div className="flex items-end gap-0.5 h-4 bg-soso-brand rounded-full px-1.5 py-1">
                          <span
                            className="w-0.5 bg-black rounded-full animate-soundwave-1"
                            style={{ height: '40%' }}
                          />
                          <span
                            className="w-0.5 bg-black rounded-full animate-soundwave-2"
                            style={{ height: '80%' }}
                          />
                          <span
                            className="w-0.5 bg-black rounded-full animate-soundwave-3"
                            style={{ height: '60%' }}
                          />
                        </div>
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-black/50 backdrop-blur-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <Play className="w-4 h-4 text-white fill-current ml-0.5" />
                        </div>
                      )}
                    </div>

                    {/* Track info */}
                    <div className="absolute bottom-0 left-0 right-0 p-2.5">
                      <p className="text-white font-bold text-xs truncate leading-tight">
                        {track.title}
                      </p>
                      <p className="text-white/60 text-[11px] font-medium truncate mt-0.5">
                        {typeof track.artist === 'object' ? track.artist?.name : track.artist}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2-COLUMN SPLIT: Любимые треки (Left) & Сохранённые альбомы (Right) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 sm:gap-6">
        {/* 💖 LEFT COLUMN: Любимые треки */}
        <div className="flex flex-col justify-between bg-white dark:bg-zinc-900 rounded-2xl p-5 sm:p-7 border border-slate-200 dark:border-zinc-800 space-y-5">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                    {t('Любимые треки')}
                  </h2>
                  <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-zinc-400 mt-0.5 truncate">
                    {likedTracks.length > 0
                      ? t('{0} в коллекции', formatTrackCount(likedTracks.length))
                      : t('Отмеченные вами треки')}
                  </p>
                </div>
              </div>

              {likedTracks.length > 0 && (
                <button
                  onClick={() => onNavigate('liked', { tab: 'tracks' })}
                  className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-500 dark:text-zinc-400 hover:text-soso-brand transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800/60"
                >
                  <span>{t('Все')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* List of recent Liked Tracks */}
            {likedTracks.length > 0 ? (
              <div className="space-y-2.5">
                {likedTracks.slice(0, 5).map((track, idx) => {
                  const isCurrent =
                    currentTrack && String(currentTrack.id) === String(track.deezer_id);
                  const isTrackPlaying = isCurrent && isPlaying;

                  return (
                    <div
                      {...youtubeDisabledProps(track, youtubeDisabled)}
                      key={track.deezer_id || idx}
                      onClick={() => handlePlayLikedTrack(track)}
                      className={`group flex items-center justify-between p-3 rounded-xl transition-colors cursor-pointer ${
                        isCurrent
                          ? 'bg-slate-200/80 dark:bg-zinc-800 text-soso-brand'
                          : 'hover:bg-slate-100 dark:hover:bg-zinc-800/60 text-slate-800 dark:text-zinc-200'
                      }`}
                    >
                      <div className="flex items-center gap-3.5 sm:gap-4 min-w-0 flex-1">
                        <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-lg overflow-hidden bg-slate-200 dark:bg-zinc-800 shrink-0">
                          <img
                            src={track.cover_url || DEFAULT_COVER_SVG_DATA_URI}
                            alt={track.title}
                            className="w-full h-full object-cover"
                            onError={(e) => {
                              e.currentTarget.onerror = null;
                              e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
                            }}
                          />
                          <div
                            className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                              isTrackPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                            }`}
                          >
                            {isTrackPlaying ? (
                              <Pause className="w-6 h-6 text-white fill-current" />
                            ) : (
                              <Play className="w-6 h-6 text-white fill-current ml-0.5" />
                            )}
                          </div>
                        </div>

                        <div className="min-w-0 flex-1 space-y-0.5">
                          <h4
                            className={`text-sm sm:text-base font-bold truncate ${
                              isCurrent ? 'text-soso-brand' : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            {track.title}
                          </h4>
                          <p className="text-xs sm:text-sm text-slate-500 dark:text-zinc-400 font-medium truncate">
                            {track.artist}
                          </p>
                        </div>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleLike({
                            id: track.deezer_id,
                            title: track.title,
                            artist: { name: track.artist },
                            album: { title: track.album },
                            preview: track.preview_url,
                            duration: track.duration,
                            source: detectTrackSource(track),
                          });
                        }}
                        className="p-2 text-rose-500 hover:scale-110 transition-transform"
                      >
                        <Heart className="w-5 h-5 sm:w-6 sm:h-6 fill-rose-500" />
                      </button>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 dark:text-zinc-500 space-y-2">
                <Music2 className="w-10 h-10 mx-auto opacity-30" />
                <p className="text-sm font-medium">{t('Здесь появятся ваши любимые композиции')}</p>
                <button
                  onClick={() => onNavigate('charts')}
                  className="inline-flex items-center gap-1.5 text-sm font-bold text-soso-brand hover:underline pt-1"
                >
                  <span>{t('Найти в чартах')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* 💿 RIGHT COLUMN: Сохранённые альбомы */}
        <div className="flex flex-col justify-between bg-white dark:bg-zinc-900 rounded-2xl p-5 sm:p-7 border border-slate-200 dark:border-zinc-800 space-y-5">
          <div className="space-y-5">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3.5 min-w-0 flex-1">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white tracking-tight truncate">
                    {t('Сохранённые альбомы')}
                  </h2>
                  <p className="text-xs sm:text-sm font-medium text-slate-500 dark:text-zinc-400 mt-0.5 truncate">
                    {savedAlbums.length > 0
                      ? t('{0} в коллекции', formatAlbumCount(savedAlbums.length))
                      : t('Альбомы, которые вы сохранили')}
                  </p>
                </div>
              </div>

              {savedAlbums.length > 0 && (
                <button
                  onClick={() => onNavigate('liked', { tab: 'albums' })}
                  className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-500 dark:text-zinc-400 hover:text-soso-brand transition-colors shrink-0 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-zinc-800/60"
                >
                  <span>{t('Все')}</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Grid of recent Saved Albums */}
            {savedAlbums.length > 0 ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3.5 sm:gap-4">
                {savedAlbums.slice(0, 6).map((album) => (
                  <div
                    {...youtubeDisabledProps(album, youtubeDisabled)}
                    key={album.id}
                    onClick={() =>
                      onNavigateToAlbum
                        ? onNavigateToAlbum({
                            id: album.id,
                            title: album.title,
                            artist: { id: (album as any).artist_id || 0, name: album.artist_name },
                            cover: album.cover_url,
                            cover_medium: album.cover_url,
                            cover_big: album.cover_url,
                            release_date: album.release_date,
                            record_type: album.record_type,
                            track_count: album.track_count,
                          })
                        : handlePlaySavedAlbum(album)
                    }
                    className="group bg-slate-50 dark:bg-zinc-800/50 hover:bg-slate-100 dark:hover:bg-zinc-800 p-3 sm:p-3.5 rounded-2xl border border-slate-200/60 dark:border-zinc-700/50 transition-all cursor-pointer"
                  >
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-700 mb-2.5 shadow-md">
                      <img
                        src={album.cover_url || DEFAULT_COVER_SVG_DATA_URI}
                        alt={album.title}
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
                        }}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-11 h-11 rounded-full bg-soso-brand flex items-center justify-center text-black shadow-lg">
                          <Play className="w-5 h-5 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>

                    <h4 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                      {album.title}
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium truncate mt-0.5">
                      {album.artist_name}
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="py-12 text-center text-slate-400 dark:text-zinc-500 space-y-2">
                <Disc3 className="w-10 h-10 mx-auto opacity-30" />
                <p className="text-sm font-medium">{t('Здесь будут добавленные вами альбомы')}</p>
                <p className="text-xs opacity-70">
                  {t('Нажмите «+» на карточке любого альбома исполнителя')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
