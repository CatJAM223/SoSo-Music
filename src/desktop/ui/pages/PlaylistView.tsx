import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import React, { useEffect, useState, useMemo } from 'react';
import { ListMusic, Play, Trash2, Music, Search, X, Plus, ImagePlus } from 'lucide-react';
import { Playlist, Track } from '../../../shared/types';
import { TasteContextMenu } from '../../../shared/components/TasteContextMenu';
import { TrackTable } from '../components/TrackTable';
import { useAudioControls } from '../../../shared/context/AudioContext';
import { ConfirmDeleteModal } from '../components/modals/ConfirmDeleteModal';
import { AddTrackToPlaylistModal } from '../components/modals/AddTrackToPlaylistModal';
import { usePlaylistTracks } from '../../../shared/hooks/usePlaylistTracks';
import { platformBridge } from '../../../shared/bridge/platformBridge';
import { CatLoader } from '../components/CatLoader';
import { preparePlaylistCover } from '../../../shared/utils/playlistCover';
import { playlistDescription } from '../../../shared/utils/playlistDescription';

interface PlaylistViewProps {
  playlist: Playlist;
  initialQuery?: string;
  onQueryChange?: (query: string) => void;
  onOpenAddToPlaylist: (track: Track) => void;
  onPlaylistDeleted: () => void;
  onNavigateToArtist?: (artist: { id?: string | number; name: string }) => void;
  onNavigateToAlbum?: (album: any) => void;
  onNavigateToSearch?: (query?: string) => void;
}

export const PlaylistView: React.FC<PlaylistViewProps> = ({
  playlist,
  initialQuery = '',
  onQueryChange,
  onOpenAddToPlaylist,
  onPlaylistDeleted,
  onNavigateToArtist,
  onNavigateToAlbum,
}) => {
  useLocale();
  const { playTrack } = useAudioControls();
  const { tracks, loading } = usePlaylistTracks(playlist.id);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  useEffect(() => {
    onQueryChange?.(searchQuery);
  }, [searchQuery, onQueryChange]);
  const [isAddTrackModalOpen, setIsAddTrackModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [coverUrl, setCoverUrl] = useState(playlist.cover_url || '');
  const [coverError, setCoverError] = useState('');

  useEffect(() => setCoverUrl(playlist.cover_url || ''), [playlist.id, playlist.cover_url]);

  const handleCoverChange = async (file?: File) => {
    if (!file) return;
    try {
      const next = await preparePlaylistCover(file);
      if (!(await platformBridge.setPlaylistCover(playlist.id, next)))
        throw new Error(t('Не удалось сохранить обложку.'));
      setCoverUrl(next);
      setCoverError('');
      window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
    } catch (error) {
      setCoverError(error instanceof Error ? error.message : t('Не удалось загрузить обложку.'));
    }
  };

  const queryLower = searchQuery.trim().toLowerCase();
  const filteredTracks = useMemo(() => {
    if (!queryLower) return tracks;
    return tracks.filter((t) => {
      const titleMatch = t.title?.toLowerCase().includes(queryLower);
      const artistMatch = (typeof t.artist === 'object' ? t.artist?.name : String(t.artist || ''))
        .toLowerCase()
        .includes(queryLower);
      const albumMatch = (typeof t.album === 'object' ? t.album?.title : String(t.album || ''))
        .toLowerCase()
        .includes(queryLower);
      return titleMatch || artistMatch || albumMatch;
    });
  }, [tracks, queryLower]);

  const handlePlayAll = () => {
    if (tracks.length > 0) {
      playTrack(tracks[0], tracks, false, undefined, { kind: 'playlist', id: String(playlist.id) });
    }
  };

  const confirmDelete = async () => {
    await platformBridge.deletePlaylist(playlist.id);
    setIsDeleteModalOpen(false);
    window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
    onPlaylistDeleted();
  };

  const totalDurationSeconds = tracks.reduce((sum, track) => sum + (track.duration || 180), 0);

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Playlist Hero Banner */}
      <div className="relative rounded-2xl overflow-hidden bg-slate-50 dark:bg-zinc-900 p-4 sm:p-6 md:p-8 border border-slate-200 dark:border-zinc-800 flex flex-col sm:flex-row items-center sm:items-start gap-4 sm:gap-6">
        <div className="w-24 h-24 sm:w-40 sm:h-40 md:w-48 md:h-48 rounded-xl bg-slate-200 dark:bg-zinc-800 flex items-center justify-center shrink-0 overflow-hidden">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={t('Обложка плейлиста')}
              className="w-full h-full object-cover"
            />
          ) : (
            <ListMusic className="w-12 h-12 sm:w-16 sm:h-16 md:w-20 md:h-20 text-soso-brand" />
          )}
        </div>

        <div className="space-y-2 sm:space-y-3 flex-1 min-w-0 text-center sm:text-left w-full">
          <span className="text-[10px] sm:text-xs font-semibold text-slate-500 dark:text-zinc-400">
            {t('Пользовательский плейлист')}
          </span>
          <h1 className="text-xl sm:text-3xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
            {playlist.name}
          </h1>
          {playlist.description && (
            <p className="text-xs text-slate-600 dark:text-zinc-300 line-clamp-2">
              {playlistDescription(playlist.description)}
            </p>
          )}
          <div className="flex items-center justify-center sm:justify-start gap-3 text-xs">
            <label className="inline-flex items-center gap-1 cursor-pointer text-soso-brand font-semibold">
              <ImagePlus className="w-4 h-4" /> {t(' Загрузить обложку')}
              <input
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => {
                  void handleCoverChange(event.target.files?.[0]);
                  event.target.value = '';
                }}
              />
            </label>
            {coverUrl && (
              <button
                type="button"
                onClick={async () => {
                  if (await platformBridge.setPlaylistCover(playlist.id, '')) {
                    setCoverUrl('');
                    window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
                  }
                }}
              >
                {t('Убрать')}
              </button>
            )}
            {coverError && (
              <span role="alert" className="text-red-500">
                {coverError}
              </span>
            )}
          </div>

          <div className="pt-1 sm:pt-2 flex items-center justify-center sm:justify-start gap-2.5 sm:gap-4 flex-wrap">
            <button
              onClick={handlePlayAll}
              disabled={tracks.length === 0}
              className="flex items-center gap-2 px-4 py-2.5 sm:px-6 sm:py-3 rounded-full bg-soso-brand hover:bg-soso-brand-light text-black font-bold text-xs sm:text-sm shadow-xl shadow-soso-brand/20 transition-all hover:scale-105 active:scale-95 disabled:opacity-40"
            >
              <Play className="w-3.5 h-3.5 sm:w-4 sm:h-4 fill-current" />
              <span>{t('Воспроизвести')}</span>
            </button>

            <button
              type="button"
              onClick={() => setIsAddTrackModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-full bg-slate-200/80 dark:bg-zinc-800 hover:bg-slate-300 dark:hover:bg-zinc-700 text-slate-800 dark:text-zinc-200 text-xs font-semibold border border-slate-300 dark:border-zinc-700 transition-all hover:scale-105 active:scale-95 shadow-xs"
              title={t('Найти и добавить треки в этот плейлист')}
            >
              <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-soso-brand" />
              <span>{t('Добавить трек')}</span>
            </button>

            <TasteContextMenu scope="playlist" id={playlist.id} label={playlist.name} />
            <button
              onClick={() => setIsDeleteModalOpen(true)}
              className="flex items-center gap-1.5 px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-full bg-white dark:bg-zinc-800/80 hover:bg-red-50 dark:hover:bg-red-500/20 text-slate-600 dark:text-zinc-400 hover:text-red-600 dark:hover:text-red-400 text-xs font-semibold border border-slate-200 dark:border-zinc-700 transition-colors shadow-xs"
            >
              <Trash2 className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
              <span>{t('Удалить плейлист')}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Instant Search Bar */}
      {tracks.length > 0 && (
        <div className="relative flex items-center w-full">
          <Search className="w-4 h-4 text-slate-400 dark:text-zinc-400 absolute left-3.5 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t('Фильтр по трекам в плейлисте...')}
            className="w-full pl-9 pr-9 py-2 soso-search-input soso-search-input-rounded text-xs sm:text-sm placeholder-slate-400 dark:placeholder-zinc-400"
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
      )}

      {/* Track Table */}
      <div>
        {loading ? (
          <CatLoader message={t('Загрузка треков плейлиста...')} />
        ) : tracks.length === 0 ? (
          <div className="py-20 text-center text-slate-400 dark:text-zinc-500 space-y-4">
            <Music className="w-12 h-12 mx-auto opacity-25" />
            <p className="text-base font-semibold text-slate-800 dark:text-zinc-300">
              {t('В этом плейлисте пока нет треков')}
            </p>
            <p className="text-xs text-slate-500 dark:text-zinc-500 max-w-sm mx-auto">
              {t('Нажмите кнопку ниже, чтобы найти треки и добавить их в этот плейлист.')}
            </p>
            <button
              type="button"
              onClick={() => setIsAddTrackModalOpen(true)}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-soso-brand text-black font-bold text-xs shadow-lg shadow-soso-brand/20 transition-all hover:scale-105 active:scale-95 cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t('Найти и добавить треки')}</span>
            </button>
          </div>
        ) : filteredTracks.length === 0 && searchQuery ? (
          <div className="py-16 text-center space-y-2">
            <Search className="w-8 h-8 text-slate-400 dark:text-zinc-600 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700 dark:text-zinc-300">
              {t('Треки не найдены')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-500">
              {t('По запросу «')}
              {searchQuery}
              {t('» совпадений в этом плейлисте не найдено.')}
            </p>
          </div>
        ) : (
          <TrackTable
            playbackOrigin={{ kind: 'playlist', id: String(playlist.id) }}
            tracks={filteredTracks}
            totalDurationSeconds={totalDurationSeconds}
            onOpenAddToPlaylist={onOpenAddToPlaylist}
            onNavigateToArtist={onNavigateToArtist}
            onNavigateToAlbum={onNavigateToAlbum}
          />
        )}
      </div>

      {/* Direct Add Track To Playlist Search & Pick Modal */}
      <AddTrackToPlaylistModal
        isOpen={isAddTrackModalOpen}
        playlist={playlist}
        existingTrackIds={new Set(tracks.map((t) => t.id))}
        onClose={() => setIsAddTrackModalOpen(false)}
      />

      {/* Styled Delete Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={isDeleteModalOpen}
        title={t('Удалить плейлист')}
        itemName={playlist.name}
        onConfirm={confirmDelete}
        onClose={() => setIsDeleteModalOpen(false)}
      />
    </div>
  );
};
