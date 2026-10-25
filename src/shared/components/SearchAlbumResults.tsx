import { useLocale } from '../i18n/useLocale';
import { t } from '../i18n/locale';
import { useYouTubeAvailability } from '../hooks/useYouTubeAvailability';
import { youtubeDisabledProps } from '../services/youtubeAvailability';
import React from 'react';
import { Disc3 } from 'lucide-react';
import type { Album } from '../types/index.ts';

interface SearchAlbumResultsProps {
  albums: Album[];
  onOpenAlbum?: (album: Album) => void;
}

export const SearchAlbumResults: React.FC<SearchAlbumResultsProps> = ({ albums, onOpenAlbum }) => {
  useLocale();
  const youtubeDisabled = useYouTubeAvailability();
  if (albums.length === 0) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Disc3 className="w-4 h-4 text-soso-brand" />
          <h2 className="text-base md:text-lg font-black text-slate-900 dark:text-white tracking-tight">
            {t('Альбомы')}
          </h2>
        </div>
        <span className="text-xs text-slate-500 dark:text-zinc-400 font-mono font-medium">
          {albums.length} {t(' найдено')}
        </span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {albums.map((album) => {
          const cover = album.cover_xl || album.cover_big || album.cover_medium || album.cover;
          return (
            <button
              type="button"
              {...youtubeDisabledProps(album, youtubeDisabled)}
              key={`${album.source || 'album'}:${album.id}`}
              onClick={() => onOpenAlbum?.(album)}
              className="group min-w-0 rounded-2xl p-2.5 text-left bg-white/70 dark:bg-zinc-900/70 hover:bg-slate-100 dark:hover:bg-zinc-800/90 border border-slate-200/80 dark:border-zinc-800/80 hover:border-soso-brand/40 transition-all shadow-xs hover:shadow-md"
            >
              <div className="aspect-square rounded-xl overflow-hidden mb-2 bg-slate-200 dark:bg-zinc-800">
                {cover ? (
                  <img
                    src={cover}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    onError={(event) => {
                      event.currentTarget.style.display = 'none';
                    }}
                  />
                ) : null}
              </div>
              <span className="block text-sm font-bold text-slate-900 dark:text-white truncate group-hover:text-soso-brand">
                {album.title}
              </span>
              <span className="block text-xs text-slate-500 dark:text-zinc-400 truncate mt-0.5">
                {album.artist?.name || (album as any).artist_name || t('Альбом')}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
};
