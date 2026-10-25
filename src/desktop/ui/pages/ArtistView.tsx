import { useLocale } from '../../../shared/i18n/useLocale';
import { t, getIntlLocale } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React from 'react';
import {
  Play,
  Pause,
  Music,
  Disc3,
  Users,
  X,
  Plus,
  Check,
  Search,
  ListMusic,
  Layers,
  List,
  ChevronRight,
} from 'lucide-react';
import { Album, Track } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';

import { CatLoader } from '../components/CatLoader';
import { SourceBadge } from '../components/SourceBadge';
import { detectTrackSource, getCoverUrl } from '../../../shared/utils/formatters';
import {
  generateInitialsAvatarUri,
  DEFAULT_COVER_SVG_DATA_URI,
} from '../../../shared/utils/placeholder';
import { useArtistViewModel } from '../../../shared/hooks/useArtistViewModel';

interface ArtistViewProps {
  artistQuery: string | number;
  artistName?: string;
  artistSource?: string;
  onOpenAddToPlaylist: (track: Track) => void;
  onNavigateToArtist: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: Album) => void;
}

export const ArtistView: React.FC<ArtistViewProps> = ({
  artistQuery,
  artistName,
  artistSource,
  onOpenAddToPlaylist,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  const {
    artistDetails,
    loading,
    allTracks,
    loadingAllTracks,
    activeTab,
    setActiveTab,
    selectedAlbum,
    setSelectedAlbum,
    albumTracks,
    loadingAlbumTracks,
    allTracksViewMode,
    setAllTracksViewMode,
    trackSearchFilter,
    setTrackSearchFilter,
    filteredAllTracks,
    groupedTracksByAlbum,
    handlePlayTopTracks,
    handleAlbumClick,
    handlePlayAlbum,
    formatRecordType,
    playTrack,
    currentTrack,
    isPlaying,
    toggleFollowArtist,
    isArtistFollowed,
    toggleSaveAlbum,
    isAlbumSaved,
  } = useArtistViewModel({ artistQuery, artistName, artistSource, onNavigateToAlbum });

  if (loading) {
    return (
      <div className="py-24">
        <CatLoader message={t('Загрузка профиля артиста...')} size="lg" />
      </div>
    );
  }

  if (!artistDetails) {
    return (
      <div className="py-24 text-center text-slate-500 dark:text-zinc-400 space-y-4">
        <Users className="w-12 h-12 mx-auto opacity-30" />
        <h2 className="text-xl font-bold text-slate-800 dark:text-zinc-200">
          {t('Исполнитель не найден')}
        </h2>
        <p className="text-sm">{t('Попробуйте поискать другого артиста в каталоге')}</p>
      </div>
    );
  }

  const { artist, topTracks, albums } = artistDetails;
  const isPlayingArtist =
    currentTrack && topTracks.some((t) => String(t.id) === String(currentTrack.id)) && isPlaying;

  return (
    <div className="space-y-8 animate-fade-in pb-12">
      {/* Artist Hero Header */}
      <div className="relative overflow-hidden rounded-2xl bg-slate-50 dark:bg-zinc-900 p-6 sm:p-8 border border-slate-200 dark:border-zinc-800">
        <div className="flex flex-col sm:flex-row items-center sm:items-end gap-6 relative z-10">
          {/* Avatar */}
          <div className="relative w-36 h-36 sm:w-44 sm:h-44 rounded-full overflow-hidden shrink-0 bg-slate-300 dark:bg-zinc-800">
            <img
              src={
                artist.picture_big ||
                artist.picture_medium ||
                artist.picture ||
                generateInitialsAvatarUri(artist.name)
              }
              alt={artist.name}
              onError={(e) => {
                e.currentTarget.onerror = null;
                e.currentTarget.src = generateInitialsAvatarUri(artist.name);
              }}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Info */}
          <div className="flex-1 text-center sm:text-left space-y-2">
            <div className="flex items-center justify-center sm:justify-start gap-1.5 text-xs font-semibold text-slate-500 dark:text-zinc-400">
              <span>{t('Исполнитель')}</span>
            </div>

            <div className="flex items-center justify-center sm:justify-start gap-3">
              <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 dark:text-white tracking-tight">
                {artist.name}
              </h1>
              <SourceBadge source={detectTrackSource(artist)} size="md" showText={true} />
            </div>

            <div className="flex items-center justify-center sm:justify-start gap-4 text-xs font-semibold text-slate-500 dark:text-zinc-400 pt-1 flex-wrap">
              {artistDetails.stats?.listeners ? (
                <span>
                  {artistDetails.stats.listeners.toLocaleString(getIntlLocale())} {t(' слушателей')}
                </span>
              ) : artist.nb_fan ? (
                <span>
                  {artist.nb_fan.toLocaleString(getIntlLocale())} {t(' слушателей')}
                </span>
              ) : null}
              {artistDetails.stats?.playcount ? (
                <span>
                  {artistDetails.stats.playcount.toLocaleString(getIntlLocale())}{' '}
                  {t(' прослушиваний')}
                </span>
              ) : null}
              {albums.length > 0 && (
                <span>
                  {albums.length} {t(' релизов')}
                </span>
              )}
              {topTracks.length > 0 ? (
                <span>
                  {topTracks.length} {t(' топ-треков')}
                </span>
              ) : null}
            </div>

            {/* Play Button */}
            <div className="pt-3 flex items-center justify-center sm:justify-start gap-3">
              <button
                {...youtubeDisabledProps(artist, youtubeDisabled)}
                onClick={handlePlayTopTracks}
                disabled={topTracks.length === 0}
                className="flex items-center gap-2 px-6 py-3 rounded-full bg-soso-brand text-black font-bold text-sm hover:scale-105 active:scale-95 transition-all shadow-lg shadow-soso-brand/25 disabled:opacity-40"
              >
                {isPlayingArtist ? (
                  <>
                    <Pause className="w-5 h-5 fill-current" />
                    <span>{t('Пауза')}</span>
                  </>
                ) : (
                  <>
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                    <span>{t('Слушать популярное')}</span>
                  </>
                )}
              </button>

              {/* Follow Artist Button */}
              <button
                onClick={() =>
                  toggleFollowArtist({
                    id: artist.id,
                    name: artist.name,
                    picture_url: artist.picture_big || artist.picture_medium || artist.picture,
                  })
                }
                className={`flex items-center gap-2 px-5 py-3 rounded-full font-bold text-sm transition-all border shadow-xs hover:scale-105 active:scale-95 ${
                  isArtistFollowed(artist.id)
                    ? 'bg-soso-brand/15 text-soso-brand border-soso-brand/40'
                    : 'bg-slate-200/90 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 border-slate-300 dark:border-zinc-700'
                }`}
              >
                {isArtistFollowed(artist.id) ? (
                  <>
                    <Check className="w-4 h-4 text-soso-brand stroke-[3]" />
                    <span>{t('Вы подписаны')}</span>
                  </>
                ) : (
                  <>
                    <Plus className="w-4 h-4 stroke-[2.5]" />
                    <span>{t('Подписаться')}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200 dark:border-zinc-800 pb-2 overflow-x-auto scrollbar-none">
        {/* Top Tracks Tab */}
        <button
          onClick={() => setActiveTab('top')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors shrink-0 ${
            activeTab === 'top'
              ? 'bg-slate-200 dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
          }`}
        >
          <Music className="w-4 h-4" />
          <span>
            {t('Популярные (')}
            {topTracks.length})
          </span>
        </button>

        {/* All Tracks Tab */}
        <button
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors shrink-0 ${
            activeTab === 'all'
              ? 'bg-slate-200 dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
          }`}
        >
          <ListMusic className="w-4 h-4 text-soso-brand" />
          <span>
            {t('Все треки ')}
            {allTracks.length > 0 ? `(${allTracks.length})` : ''}
          </span>
        </button>

        {/* Albums Tab */}
        <button
          onClick={() => setActiveTab('albums')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-colors shrink-0 ${
            activeTab === 'albums'
              ? 'bg-slate-200 dark:bg-zinc-800 text-slate-900 dark:text-white shadow-xs'
              : 'text-slate-600 dark:text-zinc-400 hover:text-slate-950 dark:hover:text-white'
          }`}
        >
          <Disc3 className="w-4 h-4" />
          <span>
            {t('Альбомы и релизы (')}
            {albums.length})
          </span>
        </button>
      </div>

      {/* 1. Top Tracks Tab Content */}
      {activeTab === 'top' && (
        <div className="space-y-6">
          <div className="space-y-4">
            <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
              {t('Популярные композиции')}
            </h2>
            {topTracks.length > 0 ? (
              <TrackTable
                tracks={topTracks}
                onOpenAddToPlaylist={onOpenAddToPlaylist}
                onNavigateToArtist={onNavigateToArtist}
                onNavigateToAlbum={onNavigateToAlbum}
              />
            ) : (
              <p className="text-sm text-slate-500 dark:text-zinc-400 py-8">
                {t('Нет популярных треков')}
              </p>
            )}
          </div>

          {/* Artist Biography from Last.fm */}
          {artistDetails.bio && (
            <div className="p-5 sm:p-6 rounded-2xl bg-white/60 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 backdrop-blur-xs space-y-2.5">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-zinc-400">
                {t('Об исполнителе')}
              </h3>
              <p className="text-sm text-slate-700 dark:text-zinc-300 leading-relaxed whitespace-pre-line line-clamp-6 hover:line-clamp-none transition-all">
                {artistDetails.bio}
              </p>
            </div>
          )}

          {/* Similar Artists from Last.fm / SoundCloud */}
          {artistDetails.similarArtists && artistDetails.similarArtists.length > 0 && (
            <div className="space-y-3 pt-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-soso-brand" />
                <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                  {t('Похожие исполнители')}
                </h3>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {artistDetails.similarArtists.map((sa) => (
                  <button
                    key={sa.id || sa.name}
                    onClick={() => onNavigateToArtist({ id: sa.id, name: sa.name })}
                    className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-slate-100 dark:bg-zinc-800/90 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-bold text-slate-800 dark:text-zinc-200 border border-slate-200/60 dark:border-zinc-700/60 transition-all hover:scale-105 active:scale-95 shadow-xs"
                  >
                    <span>{sa.name}</span>
                    <ChevronRight className="w-3 h-3 text-slate-400 dark:text-zinc-500" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. All Tracks Tab Content (Full Discography with Search Filter) */}
      {activeTab === 'all' && (
        <div className="space-y-4 animate-fade-in">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
                {t('Все треки исполнителя')}
              </h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                {t('Полный каталог синглов, альбомов и коллабораций (')}
                {filteredAllTracks.length} {t(' из')} {allTracks.length})
              </p>
            </div>

            {/* View Mode Switcher and Quick Search */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-slate-200 dark:bg-zinc-800 p-0.5 rounded-xl text-xs font-semibold">
                <button
                  onClick={() => setAllTracksViewMode('albums')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                    allTracksViewMode === 'albums'
                      ? 'bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{t('По альбомам')}</span>
                </button>
                <button
                  onClick={() => setAllTracksViewMode('list')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors ${
                    allTracksViewMode === 'list'
                      ? 'bg-white dark:bg-zinc-900 text-slate-900 dark:text-white shadow-xs'
                      : 'text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  <List className="w-3.5 h-3.5" />
                  <span>{t('Списком')}</span>
                </button>
              </div>

              {/* Quick In-Page Filter Search */}
              <div className="relative max-w-xs w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 dark:text-zinc-400" />
                <input
                  type="text"
                  placeholder={t('Фильтр по названию...')}
                  value={trackSearchFilter}
                  onChange={(e) => setTrackSearchFilter(e.target.value)}
                  className="w-full pl-9 pr-8 py-2 soso-search-input soso-search-input-rounded text-xs font-semibold placeholder-slate-400 dark:placeholder-zinc-400"
                />
                {trackSearchFilter && (
                  <button
                    onClick={() => setTrackSearchFilter('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {loadingAllTracks ? (
            <CatLoader message={t('Загружаем полный список всех треков...')} size="md" />
          ) : filteredAllTracks.length > 0 ? (
            allTracksViewMode === 'albums' ? (
              <div className="space-y-6">
                {groupedTracksByAlbum.groups.map((group) => (
                  <div
                    key={group.albumInfo.id || group.albumInfo.title}
                    className="p-4 sm:p-5 rounded-3xl bg-white/70 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 shadow-xs space-y-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div
                        onClick={() => onNavigateToAlbum && onNavigateToAlbum(group.albumInfo)}
                        className="flex items-center gap-3.5 cursor-pointer group/alb"
                      >
                        <img
                          src={group.albumInfo.cover || getCoverUrl(group.tracks[0]?.album?.cover)}
                          alt={group.albumInfo.title}
                          className="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl object-cover shadow-md group-hover/alb:scale-105 transition-transform"
                        />
                        <div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover/alb:text-soso-brand transition-colors flex items-center gap-1.5">
                            {group.albumInfo.title}
                            <ChevronRight className="w-4 h-4 opacity-50 group-hover/alb:opacity-100 group-hover/alb:translate-x-0.5 transition-all" />
                          </h3>
                          <span className="text-xs text-slate-500 dark:text-zinc-400">
                            {group.tracks.length}{' '}
                            {group.tracks.length === 1
                              ? t('трек')
                              : group.tracks.length < 5
                                ? t('трека')
                                : t('треков')}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => playTrack(group.tracks[0], group.tracks)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-soso-brand/10 hover:bg-soso-brand/20 text-soso-brand font-semibold text-xs transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{t('Слушать')}</span>
                      </button>
                    </div>
                    <TrackTable
                      tracks={group.tracks}
                      hideAlbumColumn={true}
                      onOpenAddToPlaylist={onOpenAddToPlaylist}
                      onNavigateToArtist={onNavigateToArtist}
                      onNavigateToAlbum={onNavigateToAlbum}
                    />
                  </div>
                ))}

                {groupedTracksByAlbum.singles.length > 0 && (
                  <div className="p-4 sm:p-5 rounded-3xl bg-white/70 dark:bg-zinc-900/60 border border-slate-200/80 dark:border-zinc-800/80 shadow-xs space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-bold text-slate-900 dark:text-white">
                          {t('Синглы и отдельные треки')}
                        </h3>
                        <span className="text-xs text-slate-500 dark:text-zinc-400">
                          {groupedTracksByAlbum.singles.length}{' '}
                          {groupedTracksByAlbum.singles.length === 1 ? t('трек') : t('треков')}
                        </span>
                      </div>
                      <button
                        onClick={() =>
                          playTrack(groupedTracksByAlbum.singles[0], groupedTracksByAlbum.singles)
                        }
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-soso-brand/10 hover:bg-soso-brand/20 text-soso-brand font-semibold text-xs transition-colors"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>{t('Слушать')}</span>
                      </button>
                    </div>
                    <TrackTable
                      tracks={groupedTracksByAlbum.singles}
                      hideAlbumColumn={false}
                      onOpenAddToPlaylist={onOpenAddToPlaylist}
                      onNavigateToArtist={onNavigateToArtist}
                      onNavigateToAlbum={onNavigateToAlbum}
                    />
                  </div>
                )}
              </div>
            ) : (
              <TrackTable
                tracks={filteredAllTracks}
                onOpenAddToPlaylist={onOpenAddToPlaylist}
                onNavigateToArtist={onNavigateToArtist}
                onNavigateToAlbum={onNavigateToAlbum}
              />
            )
          ) : (
            <div className="py-16 text-center text-slate-500 dark:text-zinc-400 space-y-2">
              <Music className="w-10 h-10 mx-auto opacity-30" />
              <p className="text-sm font-semibold text-slate-700 dark:text-zinc-300">
                {t('Треки не найдены')}
              </p>
              <p className="text-xs">
                {trackSearchFilter
                  ? t('Попробуйте изменить поисковый запрос в фильтре')
                  : t('Список треков временно пуст')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* 3. Albums & Discography Tab Content */}
      {activeTab === 'albums' && (
        <div className="space-y-4">
          <h2 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">
            {t('Дискография и альбомы')}
          </h2>
          {albums.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {albums.map((album) => (
                <div
                  {...youtubeDisabledProps(album, youtubeDisabled)}
                  key={album.id}
                  onClick={() => handleAlbumClick(album)}
                  className="group relative bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 p-3.5 rounded-2xl border border-slate-200/80 dark:border-zinc-800/80 transition-all duration-200 hover:shadow-xl hover:scale-[1.02] cursor-pointer flex flex-col justify-between"
                >
                  <div>
                    {/* Album Artwork with Quick Add and Play button on hover */}
                    <div className="relative aspect-square rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-800 shadow-md mb-3">
                      <img
                        src={
                          album.cover_big ||
                          album.cover_medium ||
                          album.cover ||
                          artist.picture_big ||
                          artist.picture_medium ||
                          artist.picture ||
                          DEFAULT_COVER_SVG_DATA_URI
                        }
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.onerror = null;
                          if (artist.picture_medium || artist.picture) {
                            e.currentTarget.src = artist.picture_medium || artist.picture || '';
                          } else {
                            e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
                          }
                        }}
                      />

                      {/* Quick Save Album Toggle Button (+) on Hover & Touch */}
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleSaveAlbum({
                            id: album.id,
                            title: album.title,
                            artist_name: artist.name,
                            artist: { id: artist.id, name: artist.name },
                            cover_url: album.cover_big || album.cover_medium || album.cover,
                            release_date: album.release_date,
                            record_type: album.record_type,
                            track_count: album.track_count,
                          });
                        }}
                        title={
                          isAlbumSaved(album.id)
                            ? t('Удалить из медиатеки')
                            : t('Добавить альбом в Мою музыку')
                        }
                        className={`absolute top-2 right-2 w-8 h-8 rounded-full flex items-center justify-center backdrop-blur-md transition-all shadow-md ${
                          isAlbumSaved(album.id)
                            ? 'bg-soso-brand text-black opacity-100 scale-100 hover:bg-rose-500 hover:text-white'
                            : 'bg-black/60 text-white opacity-90 md:opacity-0 md:group-hover:opacity-100 hover:scale-110 hover:bg-soso-brand hover:text-black'
                        }`}
                      >
                        {isAlbumSaved(album.id) ? (
                          <Check className="w-4 h-4 stroke-[3]" />
                        ) : (
                          <Plus className="w-4 h-4 stroke-[2.5]" />
                        )}
                      </button>

                      {/* Floating Play Button */}
                      <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <div className="w-12 h-12 rounded-full bg-soso-brand flex items-center justify-center text-black shadow-xl transform translate-y-2 group-hover:translate-y-0 transition-transform">
                          <Play className="w-6 h-6 fill-current ml-0.5" />
                        </div>
                      </div>
                    </div>

                    <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate">
                      {album.title}
                    </h3>
                  </div>

                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-zinc-400 mt-2">
                    <span>
                      {formatRecordType(album.record_type)}
                      {album.release_date ? ` • ${album.release_date.split('-')[0]}` : ''}
                    </span>
                    {album.track_count ? (
                      <span>
                        {album.track_count} {t(' тр.')}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500 dark:text-zinc-400 py-8">
              {t('Альбомы не найдены')}
            </p>
          )}
        </div>
      )}

      {/* Fallback Album Modal View */}
      {selectedAlbum && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fade-in">
          <div
            className="relative w-full max-w-2xl bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-start gap-4 pb-6 border-b border-slate-100 dark:border-zinc-800">
              <div className="w-24 h-24 rounded-2xl overflow-hidden shadow-lg shrink-0 bg-slate-200 dark:bg-zinc-800">
                <img
                  src={
                    selectedAlbum.cover_big ||
                    selectedAlbum.cover_medium ||
                    selectedAlbum.cover ||
                    artist.picture_big ||
                    artist.picture_medium ||
                    artist.picture ||
                    DEFAULT_COVER_SVG_DATA_URI
                  }
                  alt={selectedAlbum.title}
                  onError={(e) => {
                    e.currentTarget.onerror = null;
                    e.currentTarget.src = DEFAULT_COVER_SVG_DATA_URI;
                  }}
                  className="w-full h-full object-cover"
                />
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-soso-brand">
                    {formatRecordType(selectedAlbum.record_type)}
                  </span>
                  <button
                    onClick={() => setSelectedAlbum(null)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-white rounded-full hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <h2 className="text-xl font-black text-slate-900 dark:text-white truncate">
                  {selectedAlbum.title}
                </h2>
                <p className="text-xs text-slate-500 dark:text-zinc-400">
                  {artist.name}
                  {selectedAlbum.release_date
                    ? ` • ${selectedAlbum.release_date.split('-')[0]}`
                    : ''}
                </p>

                <div className="pt-2 flex items-center gap-3">
                  <button
                    onClick={handlePlayAlbum}
                    disabled={albumTracks.length === 0}
                    className="flex items-center gap-2 px-5 py-2 rounded-full bg-soso-brand text-black font-bold text-xs hover:scale-105 transition-transform disabled:opacity-50"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>{t('Слушать альбом')}</span>
                  </button>

                  <button
                    onClick={() =>
                      toggleSaveAlbum({
                        id: selectedAlbum.id,
                        title: selectedAlbum.title,
                        artist_name: artist.name,
                        artist: { id: artist.id, name: artist.name },
                        cover_url:
                          selectedAlbum.cover_big ||
                          selectedAlbum.cover_medium ||
                          selectedAlbum.cover,
                        release_date: selectedAlbum.release_date,
                        record_type: selectedAlbum.record_type,
                        track_count: selectedAlbum.track_count,
                      })
                    }
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-full font-bold text-xs transition-all border ${
                      isAlbumSaved(selectedAlbum.id)
                        ? 'bg-soso-brand/15 text-soso-brand border-soso-brand/40'
                        : 'bg-slate-200 dark:bg-zinc-800 text-slate-800 dark:text-zinc-200 border-slate-300 dark:border-zinc-700'
                    }`}
                  >
                    {isAlbumSaved(selectedAlbum.id) ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-soso-brand" />
                        <span>{t('В медиатеке')}</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t('В мою музыку')}</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Tracks List */}
            <div className="flex-1 overflow-y-auto pt-4">
              {loadingAlbumTracks ? (
                <CatLoader message={t('Загрузка треков альбома...')} size="sm" />
              ) : albumTracks.length > 0 ? (
                <TrackTable
                  tracks={albumTracks}
                  onOpenAddToPlaylist={onOpenAddToPlaylist}
                  onNavigateToArtist={onNavigateToArtist}
                  onNavigateToAlbum={onNavigateToAlbum}
                />
              ) : (
                <div className="py-12 text-center text-slate-500 dark:text-zinc-400">
                  <p className="text-xs">{t('Список треков временно недоступен')}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
