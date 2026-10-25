import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { subscribePlaylistUpdates } from '../../../shared/utils/playlistEvents';
import React, { useCallback, useEffect, useState } from 'react';
import {
  Compass,
  Search,
  Heart,
  ListMusic,
  PlusCircle,
  Disc3,
  TrendingUp,
  Settings,
  Trash2,
} from 'lucide-react';
import { Playlist } from '../../../shared/types';
import { ConfirmDeleteModal } from './modals/ConfirmDeleteModal';
import { PlaylistCover } from '../../../shared/components/PlaylistCover';
import appLogo from '../../../renderer/assets/icon.png';
import { useAudioState } from '../../../shared/context/AudioContext';
import { platformBridge } from '../../../shared/bridge/platformBridge';

interface SidebarProps {
  currentView: string;
  onNavigate: (view: string, data?: any) => void;
  onOpenCreatePlaylist: () => void;
  onOpenSettings: () => void;
  refreshPlaylistsTrigger: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentView,
  onNavigate,
  onOpenCreatePlaylist,
  onOpenSettings,
  refreshPlaylistsTrigger,
}) => {
  useLocale();
  const { likedTrackIds } = useAudioState();
  const [libraryTrackCount, setLibraryTrackCount] = useState<number | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [playlistToDelete, setPlaylistToDelete] = useState<Playlist | null>(null);

  const loadPlaylists = useCallback(async () => {
    try {
      if (window.electronAPI?.getPlaylists) {
        const list = await window.electronAPI.getPlaylists();
        setPlaylists(list);
      }
    } catch (e) {
      console.error('Error loading playlists:', e);
    }
  }, []);

  useEffect(() => {
    loadPlaylists();
    return subscribePlaylistUpdates(loadPlaylists);
  }, [loadPlaylists, refreshPlaylistsTrigger]);

  useEffect(() => {
    let active = true;
    let generation = 0;
    const refreshCount = () => {
      const request = ++generation;
      void platformBridge.getLibraryStats().then(
        (stats) => {
          if (active && request === generation) setLibraryTrackCount(stats.tracks);
        },
        (error) => console.error('Error loading library track count:', error),
      );
    };
    refreshCount();
    const unsubscribe = subscribePlaylistUpdates(refreshCount);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [likedTrackIds, refreshPlaylistsTrigger]);

  const confirmDelete = async () => {
    if (!playlistToDelete) return;
    const pId = playlistToDelete.id;
    try {
      if (window.electronAPI?.deletePlaylist) {
        await window.electronAPI.deletePlaylist(pId);
      }
    } catch (e) {
      console.error('Error deleting playlist from sidebar:', e);
    }
    setPlaylistToDelete(null);
    window.dispatchEvent(new CustomEvent('soso:playlists-updated'));
    loadPlaylists();
    if (currentView === `playlist_${pId}`) {
      onNavigate('discover');
    }
  };

  const navItems = [
    { id: 'discover', label: t('Главная'), icon: Compass },
    { id: 'search', label: t('Поиск'), icon: Search },
    { id: 'charts', label: t('Топ чарты'), icon: TrendingUp },
    { id: 'genres', label: t('Жанры'), icon: Disc3 },
    { id: 'liked', label: t('Моя музыка'), icon: Heart },
  ];

  return (
    <aside className="w-64 shrink-0 flex flex-col h-full bg-slate-50/85 dark:bg-[#0a0a0c]/85 backdrop-blur-2xl border-r border-slate-200/70 dark:border-white/[0.05] text-slate-700 dark:text-zinc-300 select-none z-20 transition-colors duration-200">
      {/* Seamless Top Brand Header (Window Drag Region with compact h-11 height) */}
      <div
        className="h-11 px-4 flex items-center gap-2.5 border-b border-slate-200/70 dark:border-white/[0.05] cursor-grab active:cursor-grabbing shrink-0"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="w-6 h-6 rounded-lg overflow-hidden shadow-xs ring-1 ring-black/5 dark:ring-white/10 shrink-0 transition-transform duration-300 hover:scale-105">
          <img src={appLogo} alt="SoSo Music" className="w-full h-full object-cover" />
        </div>
        <div>
          <h1 className="font-extrabold text-sm text-slate-900 dark:text-white tracking-tight flex items-center gap-1">
            SoSo <span className="text-soso-brand">Music</span>
          </h1>
        </div>
      </div>

      {/* Main Navigation */}
      <div data-tour="sidebar-nav" className="px-3 py-3 space-y-0.5">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive =
            currentView === item.id ||
            (item.id === 'liked' && (currentView === 'liked' || currentView === 'my-music')) ||
            (item.id === 'discover' && currentView === 'discover');
          return (
            <button
              key={item.id}
              data-tour={item.id === 'search' ? 'search-nav' : undefined}
              onClick={() => onNavigate(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[13px] transition-all duration-150 group ${
                isActive
                  ? 'bg-soso-brand/10 text-soso-brand font-semibold'
                  : 'hover:bg-slate-100 dark:hover:bg-white/[0.04] text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white font-medium'
              }`}
            >
              <Icon
                className={`w-[18px] h-[18px] shrink-0 transition-transform duration-150 group-hover:scale-105 ${
                  isActive
                    ? 'text-soso-brand'
                    : 'text-slate-400 dark:text-zinc-500 group-hover:text-slate-700 dark:group-hover:text-zinc-300'
                }`}
                size={18}
              />
              <span className="flex flex-1 min-w-0 items-baseline gap-2 text-left">
                <span className="truncate">{item.label}</span>
                {item.id === 'liked' && libraryTrackCount !== null && (
                  <span className="shrink-0 text-[11px] font-medium tabular-nums text-slate-400 dark:text-zinc-500">
                    {libraryTrackCount}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Playlists Section */}
      <div className="flex-1 flex flex-col min-h-0 px-2 py-2">
        <div className="flex items-center justify-between px-2 py-2">
          <span className="flex items-baseline gap-2 text-[11px] font-bold uppercase tracking-wider text-slate-400 dark:text-zinc-500">
            {t('Плейлисты')}
            <span className="text-[10px] font-medium tracking-normal tabular-nums opacity-70">
              {playlists.length}
            </span>
          </span>
          <button
            onClick={onOpenCreatePlaylist}
            aria-label={t('Создать новый плейлист')}
            className="p-1 rounded-md text-slate-500 dark:text-zinc-400 hover:text-soso-brand hover:bg-slate-200/80 dark:hover:bg-zinc-800 transition-colors"
          >
            <PlusCircle className="w-4 h-4" />
          </button>
        </div>

        {/* Playlist List (Scrollable) */}
        <div className="flex-1 overflow-y-auto space-y-1">
          {playlists.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-slate-400 dark:text-zinc-500">
              <ListMusic className="w-8 h-8 mx-auto mb-2 opacity-30" />
              {t('Плейлистов пока нет.')}
              <br />
              {t('Нажмите + чтобы создать.')}
            </div>
          ) : (
            playlists.map((pl) => {
              const isActive = currentView === `playlist_${pl.id}`;
              return (
                <div
                  key={pl.id}
                  onClick={() => onNavigate(`playlist_${pl.id}`, pl)}
                  className={`group flex items-center justify-between gap-2 px-2 py-2 rounded-lg text-[15px] font-medium cursor-pointer transition-all ${
                    isActive
                      ? 'bg-soso-brand/10 text-soso-brand font-semibold'
                      : 'text-slate-500 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04]'
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3 flex-1">
                    {pl.cover_url ? (
                      <img
                        src={pl.cover_url}
                        alt=""
                        className="w-12 h-12 rounded-lg object-cover shrink-0"
                      />
                    ) : (
                      <PlaylistCover size="md" className="!rounded-lg" />
                    )}
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="truncate" title={pl.name}>
                        {pl.name}
                      </span>
                      <span className="shrink-0 text-xs font-medium tabular-nums text-slate-400 dark:text-zinc-500">
                        {pl.track_count ?? 0}
                      </span>
                    </span>
                  </div>

                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setPlaylistToDelete(pl);
                    }}
                    aria-label={t('Удалить плейлист')}
                    className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-1 text-slate-400 hover:text-rose-500 rounded transition-opacity"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Settings as a regular nav item at the bottom */}
      <div className="px-3 pb-3.5 pt-2 border-t border-slate-200/70 dark:border-white/[0.05]">
        <button
          data-tour="settings-nav"
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-[14px] font-medium text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.04] transition-all duration-150 group"
        >
          <Settings className="w-5 h-5 shrink-0 text-slate-400 dark:text-zinc-500 group-hover:text-slate-700 dark:group-hover:text-zinc-300 transition-transform duration-300 group-hover:rotate-45" />
          <span className="flex-1 text-left">{t('Настройки')}</span>
        </button>
      </div>

      {/* Styled Delete Confirmation Modal */}
      <ConfirmDeleteModal
        isOpen={playlistToDelete !== null}
        title={t('Удалить плейлист')}
        itemName={playlistToDelete?.name}
        onConfirm={confirmDelete}
        onClose={() => setPlaylistToDelete(null)}
      />
    </aside>
  );
};
