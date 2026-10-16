import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { useYouTubeAvailability } from '../../../shared/hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../../../shared/services/youtubeAvailability';
import React, { useEffect, useState, useRef } from 'react';
import {
  Heart,
  Play,
  Clock,
  Disc3,
  Trash2,
  Users,
  Plus,
  Search,
  X,
  Download,
  History,
} from 'lucide-react';
import { Track } from '../../../shared/types';
import { TrackTable } from '../components/TrackTable';
import { VirtualCardGrid } from '../components/VirtualCardGrid';
import { LibraryPageControls } from '../components/LibraryPageControls';

import { formatTotalDuration, detectTrackSource } from '../../../shared/utils/formatters';
import { CatLoader } from '../components/CatLoader';
import { PlaylistCover } from '../../../shared/components/PlaylistCover';
import { playlistDescription } from '../../../shared/utils/playlistDescription';

import { useMyMusicViewModel } from '../../../shared/hooks/useMyMusicViewModel';
import { ConfirmDeleteModal } from '../components/modals/ConfirmDeleteModal';
import { ImportPlaylistModal } from '../../../shared/components/modals/ImportPlaylistModal';
import type { MyMusicPageState } from '../navigationHistory';

interface MyMusicViewProps {
  initialTab?: 'tracks' | 'playlists' | 'albums' | 'artists' | 'history' | 'offline';
  initialState?: MyMusicPageState;
  onStateChange?: (state: MyMusicPageState) => void;
  onOpenAddToPlaylist: (track: Track) => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: any) => void;
  onNavigate?: (view: string, artist?: any, album?: any, playlist?: any) => void;
  onOpenCreatePlaylist?: () => void;
  onOpenSettings?: () => void;
  refreshPlaylistsTrigger?: number;
}

export const MyMusicView: React.FC<MyMusicViewProps> = ({
  initialTab = 'tracks',
  initialState,
  onStateChange,
  onOpenAddToPlaylist,
  onNavigateToArtist,
  onNavigateToAlbum,
  onNavigate,
  onOpenCreatePlaylist,
  refreshPlaylistsTrigger,
}) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  const initialStateRef = useRef(initialState);
  const {
    activeTab,
    setActiveTab,
    sort,
    loadedCounts,
    stats,
    statsError,
    refreshStats,
    activePage,
    playbackError,
    handlePlayLibraryTrack,
    loadingPlaylists,
    tracks,
    loadingTracks,
    savedAlbums,
    loadingAlbums,
    followedArtists,
    loadingArtists,
    historyItems,
    loadingHistory,
    offlineTracks,
    loadingOffline,
    searchQuery,
    setSearchQuery,
    filteredTracks,
    filteredPlaylists,
    filteredSavedAlbums,
    filteredFollowedArtists,
    filteredOfflineTracks,
    filteredHistoryItems,
    handleClearHistory,
    confirmClearHistory,
    cancelClearHistory,
    isClearHistoryConfirmOpen,
    handleDeletePlaylist,
    playlistToDelete,
    confirmDeletePlaylist,
    cancelDeletePlaylist,
    handlePlayAllTracks,
    handlePlayPlaylist,
    totalDurationSeconds,
    playTrack,
    toggleSaveAlbum,
    toggleFollowArtist,
  } = useMyMusicViewModel({
    initialTab: initialStateRef.current?.tab || initialTab,
    initialQuery: initialStateRef.current?.query,
    initialSort: 'recent',
    initialLoadedCounts: initialStateRef.current?.loadedCounts,
    refreshPlaylistsTrigger,
  });

  useEffect(() => {
    onStateChange?.({ tab: activeTab, query: searchQuery, sort, loadedCounts });
  }, [activeTab, searchQuery, sort, loadedCounts, onStateChange]);

  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  // Global Ctrl+F / Cmd+F shortcut to focus search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in pb-12 select-none w-full max-w-full overflow-hidden">
      {/* Hero Header */}
      <div className="flex flex-wrap items-center gap-4 sm:gap-6 pb-4 md:pb-6 border-b border-slate-200 dark:border-zinc-800">
        <div className="flex flex-1 basis-96 min-w-0 items-center gap-3.5 sm:gap-6">
          <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-slate-100 dark:bg-zinc-800 flex items-center justify-center text-soso-brand flex-shrink-0">
            <Heart className="w-8 h-8 sm:w-12 sm:h-12" />
          </div>

          <div className="sm:hidden flex-1 min-w-0">
            <span className="text-[10px] font-semibold text-slate-500 dark:text-zinc-400">
              {t('Медиатека')}
            </span>
            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight truncate">
              {t('Моя музыка')}
            </h1>
            <p className="text-[11px] text-slate-500 dark:text-zinc-400">
              {stats.playlists} {t(' плейлистов • ')}
              {stats.tracks} {t(' треков')}
            </p>
          </div>
          <div className="flex-1 min-w-0 space-y-1.5 hidden sm:block">
            <span className="text-xs font-semibold text-slate-500 dark:text-zinc-400">
              {t('Медиатека')}
            </span>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight">
              {t('Моя музыка')}
            </h1>

            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-semibold text-slate-500 dark:text-zinc-400 pt-1">
              <span>
                {stats.playlists} {t(' плейлистов')}
              </span>
              <span>•</span>
              <span>
                {stats.tracks} {t(' треков')}
              </span>
              <span>•</span>
              <span>
                {stats.albums} {t(' альбомов')}
              </span>
              <span>•</span>
              <span>
                {stats.artists} {t(' исполнителей')}
              </span>
              {stats.tracks > 0 && (
                <>
                  <span>•</span>
                  <span className="flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5" />
                    {formatTotalDuration(totalDurationSeconds)}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-3 shrink-0 max-w-full">
          {/* Action Button */}
          <button
            type="button"
            aria-label={t('Перенести плейлист')}
            onClick={() => setImportOpen(true)}
            className="library-icon-action flex h-12 w-12 items-center justify-center rounded-full border border-slate-300 hover:bg-slate-100 dark:border-zinc-700 dark:hover:bg-zinc-800 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-soso-brand focus-visible:outline-offset-4"
          >
            <Download className="h-5 w-5" aria-hidden="true" />
            <span className="action-tooltip" aria-hidden="true">
              {t('Перенести плейлист')}
            </span>
          </button>
          {tracks.length > 0 && activeTab === 'tracks' && (
            <button
              type="button"
              aria-label={t('Слушать всё')}
              onClick={handlePlayAllTracks}
              className="library-icon-action flex h-12 w-12 items-center justify-center rounded-full bg-soso-brand text-black hover:brightness-110 active:scale-95 transition-all shadow-md shadow-soso-brand/25 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-soso-brand focus-visible:outline-offset-4"
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />
              <span className="action-tooltip" aria-hidden="true">
                {t('Слушать всё')}
              </span>
            </button>
          )}

          {offlineTracks.length > 0 && activeTab === 'offline' && (
            <button
              type="button"
              aria-label={t('Слушать офлайн')}
              onClick={() => offlineTracks.length > 0 && playTrack(offlineTracks[0], offlineTracks)}
              className="library-icon-action flex h-12 w-12 items-center justify-center rounded-full bg-soso-brand text-black hover:brightness-110 active:scale-95 transition-all shadow-md shadow-soso-brand/25 shrink-0 focus-visible:outline focus-visible:outline-2 focus-visible:outline-soso-brand focus-visible:outline-offset-4"
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-current ml-0.5" />
              <span className="action-tooltip" aria-hidden="true">
                {t('Слушать офлайн')}
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Modern Tabs Navigation */}
      <div className="flex items-center gap-0 border-b border-slate-200 dark:border-zinc-800 overflow-x-auto scrollbar-none w-full">
        {/* Tracks Tab */}
        <button
          onClick={() => setActiveTab('tracks')}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all flex-shrink-0 border-b-2 -mb-px ${
            activeTab === 'tracks'
              ? 'border-soso-brand text-soso-brand'
              : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-zinc-600'
          }`}
        >
          {t('Любимые')}
        </button>

        {/* Playlists Tab */}
        <button
          onClick={() => setActiveTab('playlists')}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all flex-shrink-0 border-b-2 -mb-px ${
            activeTab === 'playlists'
              ? 'border-soso-brand text-soso-brand'
              : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-zinc-600'
          }`}
        >
          {t('Плейлисты')}
        </button>

        {/* Albums Tab */}
        <button
          onClick={() => setActiveTab('albums')}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all flex-shrink-0 border-b-2 -mb-px ${
            activeTab === 'albums'
              ? 'border-soso-brand text-soso-brand'
              : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-zinc-600'
          }`}
        >
          {t('Альбомы')}
        </button>

        {/* Artists Tab */}
        <button
          onClick={() => setActiveTab('artists')}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all flex-shrink-0 border-b-2 -mb-px ${
            activeTab === 'artists'
              ? 'border-soso-brand text-soso-brand'
              : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-zinc-600'
          }`}
        >
          {t('Исполнители')}
        </button>

        {/* History Tab */}
        <button
          onClick={() => setActiveTab('history')}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all flex-shrink-0 border-b-2 -mb-px ${
            activeTab === 'history'
              ? 'border-soso-brand text-soso-brand'
              : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-zinc-600'
          }`}
        >
          {t('Недавние')}
        </button>

        {/* Offline Tab */}
        <button
          onClick={() => setActiveTab('offline')}
          className={`relative flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold transition-all flex-shrink-0 border-b-2 -mb-px ${
            activeTab === 'offline'
              ? 'border-soso-brand text-soso-brand'
              : 'border-transparent text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:border-slate-300 dark:hover:border-zinc-600'
          }`}
        >
          {t('Офлайн')}
        </button>
      </div>

      {/* Quick Instant Search Filter Bar */}
      <div className="relative flex items-center w-full">
        <Search className="w-4 h-4 text-slate-400 dark:text-zinc-400 absolute left-3.5 pointer-events-none" />
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          maxLength={512}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={t('Фильтр по названию, артисту или альбому... (Ctrl+F)')}
          className="w-full pl-9 pr-9 py-2.5 soso-search-input soso-search-input-rounded text-xs sm:text-sm placeholder-slate-400 dark:placeholder-zinc-400"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery('')}
            className="absolute right-3 p-1 rounded-full text-slate-400 hover:text-slate-700 dark:hover:text-zinc-200 hover:bg-slate-200 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {statsError && (
        <div role="alert">
          {t('Не удалось обновить сведения о медиатеке.')}{' '}
          <button onClick={refreshStats}>{t('Повторить')}</button>
        </div>
      )}
      {playbackError && <div role="alert">{playbackError}</div>}

      {/* Tab 0: Playlists */}
      {activeTab === 'playlists' && (
        <div className="space-y-4">
          {loadingPlaylists ? (
            <CatLoader message={t('Загружаем ваши плейлисты...')} size="md" className="py-20" />
          ) : filteredPlaylists.length === 0 && searchQuery ? (
            <div className="py-16 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
                {t('Плейлисты не найдены')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('По запросу «')}
                {searchQuery}
                {t('» ничего не найдено.')}
              </p>
            </div>
          ) : (
            <VirtualCardGrid
              kind="playlists"
              items={filteredPlaylists}
              itemKey={(pl) => String(pl.id)}
              label={t('Медиатека')}
              leading={
                !searchQuery ? (
                  <div
                    onClick={onOpenCreatePlaylist}
                    className="group relative p-4 rounded-2xl bg-white/60 dark:bg-zinc-900/40 hover:bg-slate-100 dark:hover:bg-zinc-800/80 border-2 border-dashed border-slate-300 dark:border-zinc-700 hover:border-soso-brand dark:hover:border-soso-brand transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex flex-col items-center justify-center text-center min-h-[170px]"
                  >
                    <div className="w-12 h-12 rounded-full bg-soso-brand/15 text-soso-brand flex items-center justify-center mb-2 group-hover:scale-110 transition-transform">
                      <Plus className="w-6 h-6" />
                    </div>
                    <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white">
                      {t('Новый плейлист')}
                    </h3>
                    <p className="text-[10px] text-slate-500 dark:text-zinc-400 mt-0.5">
                      {t('Создать свою подборку')}
                    </p>
                  </div>
                ) : undefined
              }
              renderItem={(pl) => (
                <div
                  key={pl.id}
                  onClick={() => onNavigate?.(`playlist_${pl.id}`, undefined, undefined, pl)}
                  className="group relative p-3 rounded-2xl bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 border border-slate-200/80 dark:border-zinc-800/80 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex flex-col"
                >
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden mb-3">
                    {pl.cover_url ? (
                      <img src={pl.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <PlaylistCover className="w-full h-full object-cover" />
                    )}

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div
                        onClick={(e) => handlePlayPlaylist(e, pl)}
                        className="w-11 h-11 rounded-full bg-soso-brand text-black flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform"
                      >
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>

                    <button
                      onClick={(e) => handleDeletePlaylist(e, pl.id)}
                      aria-label={t('Удалить плейлист')}
                      className="absolute top-2 right-2 z-20 w-7 h-7 rounded-full flex items-center justify-center shadow-lg transition-all opacity-100 md:opacity-0 md:group-hover:opacity-100 bg-black/75 hover:bg-rose-600 text-white hover:scale-110"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-xs sm:text-sm text-slate-900 dark:text-white truncate group-hover:text-soso-brand transition-colors">
                      {pl.name}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                      {playlistDescription(pl.description) || t('Пользовательский плейлист')}
                    </p>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      )}

      {/* Tab 1: Liked Tracks */}
      {activeTab === 'tracks' && (
        <div className="space-y-4">
          {loadingTracks ? (
            <CatLoader message={t('Загружаем ваши любимые треки...')} size="md" className="py-20" />
          ) : filteredTracks.length > 0 ? (
            <TrackTable
              tracks={filteredTracks}
              onPlayTrack={handlePlayLibraryTrack}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              onNavigateToArtist={onNavigateToArtist}
              onNavigateToAlbum={onNavigateToAlbum}
            />
          ) : stats.tracks > 0 && searchQuery ? (
            <div className="py-16 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
                {t('Треки не найдены')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('По запросу «')}
                {searchQuery}
                {t('» совпадений не найдено.')}
              </p>
            </div>
          ) : (
            <div className="py-20 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-100 dark:bg-zinc-800 text-slate-500 dark:text-zinc-400 flex items-center justify-center mx-auto mb-2">
                <Heart className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('Нет сохранённых треков')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500 max-w-sm mx-auto">
                {t(
                  'Нажмите на сердечко рядом с любым треком в чартах или поиске, чтобы добавить его в свою коллекцию.',
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Saved Albums */}
      {activeTab === 'albums' && (
        <div className="space-y-4">
          {loadingAlbums ? (
            <CatLoader
              message={t('Загружаем сохранённые альбомы...')}
              size="md"
              className="py-20"
            />
          ) : filteredSavedAlbums.length === 0 && searchQuery ? (
            <div className="py-16 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
                {t('Альбомы не найдены')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('По запросу «')}
                {searchQuery}
                {t('» совпадений не найдено.')}
              </p>
            </div>
          ) : savedAlbums.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-soso-brand/10 text-soso-brand flex items-center justify-center mx-auto mb-2">
                <Disc3 className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('Нет сохранённых альбомов')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500 max-w-sm mx-auto">
                {t('Нажмите ')}
                <strong>«+»</strong> {t(' на карточке альбома у любого исполнителя или кнопку')}{' '}
                <strong>{t('«В мою музыку»')}</strong>{' '}
                {t(' внутри альбома, чтобы сохранить его сюда.')}
              </p>
            </div>
          ) : (
            <VirtualCardGrid
              kind="albums"
              items={filteredSavedAlbums}
              itemKey={(album) => String(album.id)}
              label={t('Медиатека')}
              renderItem={(album) => (
                <div
                  {...youtubeDisabledProps(album, youtubeDisabled)}
                  key={album.id}
                  onClick={() =>
                    onNavigateToAlbum?.({
                      id: album.id,
                      title: album.title,
                      cover: album.cover_url,
                      cover_url: album.cover_url,
                      cover_medium: album.cover_url,
                      cover_big: album.cover_url,
                      cover_xl: album.cover_url,
                      artist: { id: album.artist_id, name: album.artist_name },
                      artist_name: album.artist_name,
                      release_date: album.release_date,
                      record_type: album.record_type,
                      track_count: album.track_count,
                      source: detectTrackSource(album),
                    })
                  }
                  className="group relative p-3 rounded-2xl bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 border border-slate-200/80 dark:border-zinc-800/80 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex flex-col"
                >
                  <div className="relative aspect-square w-full rounded-xl overflow-hidden bg-slate-200 dark:bg-zinc-800 mb-3 flex items-center justify-center">
                    {album.cover_url && !album.cover_url.includes('unsplash.com') ? (
                      <img
                        src={album.cover_url}
                        alt={album.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 relative z-10"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <Disc3 className="w-10 h-10 text-zinc-400 absolute z-0 pointer-events-none" />

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-11 h-11 rounded-full bg-soso-brand text-black flex items-center justify-center shadow-lg transform translate-y-2 group-hover:translate-y-0 transition-transform">
                        <Play className="w-5 h-5 fill-current ml-0.5" />
                      </div>
                    </div>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSaveAlbum(album);
                      }}
                      aria-label={t('Удалить из сохранённых альбомов')}
                      className="absolute top-2.5 right-2.5 z-20 w-8 h-8 rounded-full flex items-center justify-center shadow-lg transition-all duration-200 transform opacity-100 md:opacity-0 md:group-hover:opacity-100 bg-black/75 hover:bg-rose-600 text-white hover:scale-110"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="flex-1 min-w-0">
                    <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate group-hover:text-soso-brand transition-colors">
                      {album.title}
                    </h3>
                    <p
                      onClick={(e) => {
                        if (onNavigateToArtist && album.artist_name) {
                          e.stopPropagation();
                          onNavigateToArtist({
                            id: album.artist_id,
                            name: album.artist_name,
                          });
                        }
                      }}
                      className="text-xs text-slate-500 dark:text-zinc-400 truncate mt-1 hover:underline hover:text-slate-900 dark:hover:text-white"
                    >
                      {album.artist_name}
                    </p>
                  </div>
                </div>
              )}
            />
          )}
        </div>
      )}

      {/* Tab 3: Followed Artists */}
      {activeTab === 'artists' && (
        <div className="space-y-4">
          {loadingArtists ? (
            <CatLoader message={t('Загружаем ваших исполнителей...')} size="md" className="py-20" />
          ) : filteredFollowedArtists.length === 0 && searchQuery ? (
            <div className="py-16 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
                {t('Исполнители не найдены')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('По запросу «')}
                {searchQuery}
                {t('» совпадений не найдено.')}
              </p>
            </div>
          ) : followedArtists.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-sky-500/10 text-sky-500 flex items-center justify-center mx-auto mb-2">
                <Users className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('Нет отслеживаемых исполнителей')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500 max-w-sm mx-auto">
                {t('Подпишитесь на любимых артистов кнопкой ')}
                <strong>{t('«Подписаться»')}</strong>{' '}
                {t(' на их странице, чтобы они учитывались в ')}
                <strong>{t('«Моей волне»')}</strong>.
              </p>
            </div>
          ) : (
            <VirtualCardGrid
              kind="artists"
              items={filteredFollowedArtists}
              itemKey={(artist) => String(artist.id)}
              label={t('Медиатека')}
              renderItem={(artist) => (
                <div
                  {...youtubeDisabledProps(artist, youtubeDisabled)}
                  key={artist.id}
                  onClick={() =>
                    onNavigateToArtist?.({
                      id: artist.id,
                      name: artist.name,
                    })
                  }
                  className="group relative p-4 rounded-2xl bg-white dark:bg-zinc-900/60 hover:bg-slate-100 dark:hover:bg-zinc-800/80 border border-slate-200/80 dark:border-zinc-800/80 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-md flex flex-col items-center text-center"
                >
                  {/* Unfollow button on top-right of card */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFollowArtist({
                        id: artist.id,
                        name: artist.name,
                        picture_url: artist.picture_url,
                      });
                    }}
                    aria-label={t('Отписаться от исполнителя')}
                    className="absolute top-2.5 right-2.5 z-20 w-7 h-7 rounded-full bg-slate-200/90 dark:bg-zinc-800/90 hover:bg-rose-600 hover:text-white text-slate-600 dark:text-zinc-400 flex items-center justify-center opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-all shadow-md hover:scale-110"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>

                  {/* Circular Avatar */}
                  <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full overflow-hidden bg-slate-200 dark:bg-zinc-800 mb-3 shadow-md ring-2 ring-slate-200 dark:ring-zinc-700 group-hover:ring-sky-400 transition-all flex items-center justify-center">
                    {artist.picture_url && !artist.picture_url.includes('unsplash.com') ? (
                      <img
                        src={artist.picture_url}
                        alt={artist.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform relative z-10"
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = 'none';
                        }}
                      />
                    ) : null}
                    <Users className="w-8 h-8 text-zinc-400 absolute z-0 pointer-events-none" />
                  </div>

                  <h3 className="font-bold text-sm text-slate-900 dark:text-white truncate w-full group-hover:text-sky-500 transition-colors">
                    {artist.name}
                  </h3>
                  <span className="text-[11px] font-semibold text-slate-400 dark:text-zinc-500 mt-0.5">
                    {t('Исполнитель')}
                  </span>
                </div>
              )}
            />
          )}
        </div>
      )}

      {/* Tab 4: Listening History */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
              {t('Недавно прослушанные треки')}
            </h2>
            {historyItems.length > 0 && (
              <button
                onClick={handleClearHistory}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-200/80 dark:bg-zinc-800/80 text-rose-500 hover:bg-rose-500 hover:text-white text-xs font-bold transition-all shadow-sm"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>{t('Очистить историю')}</span>
              </button>
            )}
          </div>

          {loadingHistory ? (
            <CatLoader message={t('Загружаем историю...')} size="md" className="py-20" />
          ) : filteredHistoryItems.length === 0 && searchQuery ? (
            <div className="py-16 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
                {t('В истории ничего не найдено')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('По запросу «')}
                {searchQuery}
                {t('» совпадений нет.')}
              </p>
            </div>
          ) : historyItems.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-purple-500/10 text-purple-400 flex items-center justify-center mx-auto mb-2">
                <History className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('История прослушиваний пуста')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500 max-w-sm mx-auto">
                {t('Здесь будут появляться треки, которые вы слушали в приложении.')}
              </p>
            </div>
          ) : (
            <TrackTable
              tracks={filteredHistoryItems.map((h) => ({
                id: h.track_id,
                title: h.title,
                artist: { name: h.artist },
                album: { id: 0, title: h.album || '', cover: h.cover_url || '' },
                duration: h.duration || 180,
                preview: '',
                source: h.source || 'soundcloud',
              }))}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              onNavigateToArtist={onNavigateToArtist}
              onNavigateToAlbum={onNavigateToAlbum}
            />
          )}
        </div>
      )}

      {/* Tab 5: Offline Cached Tracks */}
      {activeTab === 'offline' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
              {t('Скачанные треки (Офлайн)')}
            </h2>
          </div>

          {loadingOffline ? (
            <CatLoader message={t('Загружаем офлайн треки...')} size="md" className="py-20" />
          ) : filteredOfflineTracks.length === 0 && searchQuery ? (
            <div className="py-16 text-center space-y-2">
              <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
              <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
                {t('В офлайн кэше ничего не найдено')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500">
                {t('По запросу «')}
                {searchQuery}
                {t('» совпадений нет.')}
              </p>
            </div>
          ) : offlineTracks.length === 0 ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-2">
                <Download className="w-8 h-8 opacity-40" />
              </div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white">
                {t('Нет сохранённых офлайн треков')}
              </h3>
              <p className="text-xs text-slate-500 dark:text-zinc-500 max-w-sm mx-auto">
                {t(
                  'Нажмите на значок скачивания рядом с любым треком, чтобы слушать его без интернета.',
                )}
              </p>
            </div>
          ) : (
            <TrackTable
              tracks={filteredOfflineTracks}
              onOpenAddToPlaylist={onOpenAddToPlaylist}
              onNavigateToArtist={onNavigateToArtist}
              onNavigateToAlbum={onNavigateToAlbum}
            />
          )}
        </div>
      )}

      {activePage && (
        <LibraryPageControls
          loaded={activePage.items.length}
          total={activePage.total}
          loading={activePage.loading || activePage.loadingMore}
          refreshing={activePage.refreshing}
          error={activePage.error}
          hasMore={activePage.nextOffset !== null}
          onLoadMore={activePage.loadMore}
          onRetry={activePage.retry}
        />
      )}

      {/* Confirm Delete Playlist Modal */}
      {importOpen && (
        <ImportPlaylistModal
          onClose={() => setImportOpen(false)}
          onSaved={() => {
            window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
            setActiveTab('playlists');
          }}
        />
      )}
      <ConfirmDeleteModal
        isOpen={Boolean(playlistToDelete)}
        title={t('Удалить плейлист')}
        itemName={playlistToDelete?.name}
        onConfirm={confirmDeletePlaylist}
        onClose={cancelDeletePlaylist}
      />

      {/* Confirm Clear History Modal */}
      <ConfirmDeleteModal
        isOpen={isClearHistoryConfirmOpen}
        title={t('Очистить историю')}
        description={t(
          'Вы уверены, что хотите очистить всю историю прослушиваний? Это действие нельзя отменить.',
        )}
        confirmText={t('Очистить')}
        onConfirm={confirmClearHistory}
        onClose={cancelClearHistory}
      />
    </div>
  );
};
