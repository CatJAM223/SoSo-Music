import { useLocale } from '../../../../shared/i18n/useLocale';
import { t } from '../../../../shared/i18n/locale';
import React, { useEffect, useState } from 'react';
import { X, Check, Plus, Loader2 } from 'lucide-react';
import { Playlist, Track } from '../../../../shared/types';
import { detectTrackSource } from '../../../../shared/utils/formatters';
import { PlaylistCover } from '../../../../shared/components/PlaylistCover';
import { platformBridge } from '../../../../shared/bridge/platformBridge';

interface AddToPlaylistModalProps {
  track: Track | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenCreatePlaylist: () => void;
}

export const AddToPlaylistModal: React.FC<AddToPlaylistModalProps> = ({
  track,
  isOpen,
  onClose,
  onOpenCreatePlaylist,
}) => {
  useLocale();
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [addedPlaylists, setAddedPlaylists] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const loadRequest = React.useRef(0);
  const pendingMutations = React.useRef(new Set<string>());

  const onCloseRef = React.useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen && track) {
      loadPlaylists();

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCloseRef.current();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => {
        loadRequest.current++;
        window.removeEventListener('keydown', handleKeyDown);
      };
    }
  }, [isOpen, track?.id]);

  const loadPlaylists = async () => {
    const request = ++loadRequest.current;
    setLoading(true);
    try {
      const [list, membership] = await Promise.all([
        platformBridge.getPlaylists(),
        platformBridge.getTrackPlaylistIds(track!.id),
      ]);
      if (request !== loadRequest.current) return;
      setPlaylists(list || []);
      setAddedPlaylists(new Set(membership));
    } catch (error) {
      console.error('Error loading playlists:', error);
    } finally {
      if (request === loadRequest.current) setLoading(false);
    }
  };

  if (!isOpen || !track) return null;

  const handleToggleTrackInPlaylist = async (playlist: Playlist) => {
    if (pendingMutations.current.has(playlist.id)) return;
    pendingMutations.current.add(playlist.id);
    const request = loadRequest.current;
    const isAlreadyIn = addedPlaylists.has(playlist.id);

    try {
      if (isAlreadyIn) {
        if (!(await platformBridge.removeTrackFromPlaylist(playlist.id, track.id))) return;
        if (request !== loadRequest.current) return;
        setAddedPlaylists((prev) => {
          const next = new Set(prev);
          next.delete(playlist.id);
          return next;
        });
      } else {
        const success = await platformBridge.addTrackToPlaylist(playlist.id, {
          id: track.id,
          deezer_id: track.id,
          title: track.title,
          artist:
            track.artist?.name ||
            (typeof track.artist === 'string' ? track.artist : 'Unknown Artist'),
          album: track.album?.title || (typeof track.album === 'string' ? track.album : ''),
          cover_url:
            track.album?.cover_medium ||
            track.album?.cover ||
            track.album?.cover_big ||
            track.album?.cover_xl ||
            (typeof track.artist === 'object'
              ? track.artist?.picture_medium || track.artist?.picture
              : '') ||
            '',
          preview_url: track.preview || '',
          duration: track.duration || 180,
          source: detectTrackSource(track),
        } as any);
        if (!success || request !== loadRequest.current) return;
        setAddedPlaylists((prev) => {
          const next = new Set(prev);
          next.add(playlist.id);
          return next;
        });
      }
    } catch (err) {
      console.error('Error toggling track in playlist:', err);
    } finally {
      pendingMutations.current.delete(playlist.id);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 rounded-2xl w-full max-w-md p-6 shadow-2xl flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-zinc-800">
          <div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t('Добавить в плейлист')}
            </h3>
            <p className="text-xs text-slate-500 dark:text-zinc-400 truncate max-w-xs mt-0.5">
              {track.title} — {track.artist?.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Playlist selection list */}
        <div className="flex-1 overflow-y-auto py-4 space-y-1">
          {loading ? (
            <div className="py-8 flex items-center justify-center text-slate-400 dark:text-zinc-500 gap-2">
              <Loader2 className="w-5 h-5 animate-spin text-soso-brand" />
              <span className="text-sm">{t('Загрузка плейлистов...')}</span>
            </div>
          ) : playlists.length === 0 ? (
            <div className="py-8 text-center text-xs text-slate-400 dark:text-zinc-500">
              {t('У вас еще нет плейлистов.')}
              <br />
              {t('Создайте свой первый плейлист ниже!')}
            </div>
          ) : (
            playlists.map((pl) => {
              const isAdded = addedPlaylists.has(pl.id);
              return (
                <div
                  key={pl.id}
                  onClick={() => handleToggleTrackInPlaylist(pl)}
                  className={`flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all ${
                    isAdded
                      ? 'bg-soso-brand/15 border border-soso-brand/30 text-slate-900 dark:text-white'
                      : 'hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-slate-700 dark:text-zinc-300 hover:text-slate-950 dark:hover:text-white'
                  }`}
                >
                  <div className="flex items-center gap-3 truncate">
                    <PlaylistCover
                      covers={pl.cover_url ? [pl.cover_url] : []}
                      size="sm"
                      className="!w-9 !h-9"
                    />
                    <div className="truncate">
                      <p className="text-sm font-semibold truncate">{pl.name}</p>
                      <p className="text-xs text-slate-400 dark:text-zinc-500">
                        {pl.track_count || 0} {t(' треков')}
                      </p>
                    </div>
                  </div>

                  <div
                    className={`w-6 h-6 rounded-full border flex items-center justify-center transition-all ${
                      isAdded
                        ? 'bg-soso-brand border-soso-brand text-black'
                        : 'border-slate-300 dark:border-zinc-600 text-transparent'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-slate-100 dark:border-zinc-800 flex items-center justify-between">
          <button
            onClick={() => {
              onClose();
              onOpenCreatePlaylist();
            }}
            className="flex items-center gap-2 text-xs font-semibold text-soso-brand hover:underline"
          >
            <Plus className="w-4 h-4" />
            <span>{t('Создать новый плейлист')}</span>
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 text-xs font-semibold text-slate-800 dark:text-white transition-colors"
          >
            {t('Готово')}
          </button>
        </div>
      </div>
    </div>
  );
};
