import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React from 'react';
import { Play, Pause, Disc3, Plus, Check } from 'lucide-react';
import { Album, Track } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';
import { useAudioControls } from '../../../shared/context/AudioContext';
import { formatTotalDuration, detectTrackSource } from '../../../shared/utils/formatters';
import { CatLoader } from '../components/CatLoader';
import { SourceBadge } from '../components/SourceBadge';
import { useAlbumViewModel } from '../../../shared/hooks/useAlbumViewModel';

interface AlbumViewProps {
  album:
    | Album
    | {
        id: string | number;
        title: string;
        cover?: string;
        cover_medium?: string;
        cover_big?: string;
        artist?: any;
        release_date?: string;
        record_type?: string;
      };
  onOpenAddToPlaylist: (track: Track) => void;
  onNavigateToArtist: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: Album) => void;
}

export const AlbumView: React.FC<AlbumViewProps> = ({
  album,
  onOpenAddToPlaylist,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  const { toggleSaveAlbum, isAlbumSaved } = useAudioControls();
  const {
    tracks,
    loading,
    albumId,
    albumTitle,
    artistName,
    artistId,
    recordType,
    releaseDate,
    coverUrl,
    isPlayingThisAlbum,
    handlePlayAlbum,
    totalDurationSecs,
    formatRecordType,
  } = useAlbumViewModel({ album });

  const isSaved = isAlbumSaved(albumId) || isAlbumSaved(album.id);

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Album Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-50 dark:bg-zinc-900 p-6 sm:p-8 border border-slate-200 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 relative z-10">
          {/* Artwork */}
          <div className="relative w-44 h-44 sm:w-52 sm:h-52 rounded-xl overflow-hidden shrink-0 bg-slate-300 dark:bg-zinc-800 group">
            <img src={coverUrl} alt={albumTitle} className="w-full h-full object-cover" />
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left space-y-2">
            <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400">
              <Disc3 className="w-4 h-4 text-soso-brand" />
              <span>{formatRecordType(recordType)}</span>
            </div>

            <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight leading-tight">
              {albumTitle}
            </h1>

            <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 text-sm font-semibold text-slate-600 dark:text-zinc-300 pt-1">
              <span
                onClick={() => onNavigateToArtist({ id: artistId, name: artistName })}
                className="text-slate-900 dark:text-white font-bold hover:underline hover:text-soso-brand cursor-pointer transition-colors"
              >
                {artistName}
              </span>
              <SourceBadge source={detectTrackSource({ ...album, id: albumId })} size="sm" />

              {releaseDate && (
                <>
                  <span>•</span>
                  <span>
                    {String(releaseDate).match(/\b(19\d\d|20\d\d)\b/)?.[1] ||
                      new Date(releaseDate).getFullYear()}
                  </span>
                </>
              )}

              {tracks.length > 0 && (
                <>
                  <span>•</span>
                  <span>
                    {tracks.length} {t(' треков')}
                  </span>
                </>
              )}

              {totalDurationSecs > 0 && (
                <>
                  <span>•</span>
                  <span className="text-slate-500 dark:text-zinc-400">
                    {formatTotalDuration(totalDurationSecs)}
                  </span>
                </>
              )}
            </div>

            {/* Play & Add Album Buttons */}
            <div className="pt-4 flex items-center justify-center sm:justify-start gap-3 flex-wrap">
              {tracks.length > 0 && (
                <button
                  {...youtubeDisabledProps(album, youtubeDisabled)}
                  onClick={handlePlayAlbum}
                  className="flex items-center gap-2 px-6 py-3 rounded-full bg-soso-brand text-black font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-lg shadow-soso-brand/25"
                >
                  {isPlayingThisAlbum ? (
                    <>
                      <Pause className="w-5 h-5 fill-current" />
                      <span>{t('Пауза')}</span>
                    </>
                  ) : (
                    <>
                      <Play className="w-5 h-5 fill-current ml-0.5" />
                      <span>{t('Слушать альбом')}</span>
                    </>
                  )}
                </button>
              )}

              {/* Add / Remove from Library Button */}
              <button
                onClick={() =>
                  toggleSaveAlbum({
                    id: albumId,
                    title: albumTitle,
                    artist_name: artistName,
                    artist: album.artist || { id: artistId, name: artistName },
                    cover_url: coverUrl,
                    release_date: releaseDate,
                    record_type: recordType,
                    track_count: tracks.length || (album as any).track_count || 0,
                  })
                }
                title={isSaved ? t('Удалить из Моей музыки') : t('Добавить альбом в Мою музыку')}
                className={`flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm transition-all shadow-md hover:scale-105 active:scale-95 border ${
                  isSaved
                    ? 'bg-soso-brand/15 text-soso-brand border-soso-brand/40 hover:bg-rose-500/15 hover:text-rose-500 hover:border-rose-500/40'
                    : 'bg-slate-200/90 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 border-slate-300 dark:border-zinc-700 hover:bg-slate-300 dark:hover:bg-zinc-700'
                }`}
              >
                {isSaved ? (
                  <>
                    <Check className="w-4 h-4 text-soso-brand" />
                    <span>{t('В медиатеке')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4" />
                    <span>{t('В мою музыку')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tracks Table (Hide redundant Album column) */}
      <div className="space-y-4">
        <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
          {t('Треки альбома')}
        </h2>

        {loading ? (
          <CatLoader message={t('Загрузка треков альбома...')} size="md" />
        ) : tracks.length > 0 ? (
          <TrackTable
            tracks={tracks}
            onOpenAddToPlaylist={onOpenAddToPlaylist}
            onNavigateToArtist={onNavigateToArtist}
            onNavigateToAlbum={onNavigateToAlbum}
            hideAlbumColumn={true}
          />
        ) : (
          <div className="py-16 text-center text-slate-500 dark:text-zinc-400">
            <p className="text-sm font-medium">{t('Список треков временно недоступен')}</p>
          </div>
        )}
      </div>
    </div>
  );
};
