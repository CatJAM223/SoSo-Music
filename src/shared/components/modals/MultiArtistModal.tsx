import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import React, { useEffect, useState } from 'react';
import { X, ChevronRight, Users } from 'lucide-react';

import { platformBridge } from '../../bridge/platformBridge';
import { generateInitialsAvatarUri } from '../../utils/placeholder';

interface MultiArtistModalProps {
  isOpen: boolean;
  artists: string[];
  onClose: () => void;
  onSelectArtist: (artist: { id?: string | number; name: string }) => void;
}

interface ArtistInfo {
  name: string;
  picture?: string;
  id?: string | number;
  source?: string;
  nb_fan?: number;
}

export const MultiArtistModal: React.FC<MultiArtistModalProps> = ({
  isOpen,
  artists,
  onClose,
  onSelectArtist,
}) => {
  useLocale();
  const [artistDetails, setArtistDetails] = useState<ArtistInfo[]>([]);
  const [, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || artists.length === 0) {
      setArtistDetails([]);
      return;
    }

    let isMounted = true;
    setLoading(true);

    const loadArtistAvatars = async () => {
      try {
        const promises = artists.map(async (name) => {
          try {
            if (platformBridge.searchArtists) {
              const res = await platformBridge.searchArtists(name, 1);
              const found = res?.data?.[0];
              if (found) {
                return {
                  name,
                  id: found.id,
                  picture: found.picture_big || found.picture_medium || found.picture,
                  source: found.source,
                  nb_fan: found.nb_fan,
                };
              }
            }
          } catch (e) {}
          return { name };
        });

        const results = await Promise.all(promises);
        if (isMounted) {
          setArtistDetails(results);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    loadArtistAvatars();

    return () => {
      isMounted = false;
    };
  }, [isOpen, artists]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, onClose]);

  if (!isOpen || artists.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 rounded-3xl p-5 sm:p-6 shadow-2xl max-w-md w-full animate-scale-up space-y-4 text-slate-900 dark:text-white"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-soso-brand/15 text-soso-brand">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">{t('Исполнители трека')}</h2>
              <p className="text-xs text-slate-500 dark:text-zinc-400">
                {t('Выберите исполнителя для перехода к дискографии')}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Artist List */}
        <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
          {artistDetails.map((artist, idx) => {
            const fallbackPic = generateInitialsAvatarUri(artist.name);
            const displayPic = artist.picture || fallbackPic;

            return (
              <div
                key={idx}
                onClick={() => {
                  onSelectArtist({
                    id: artist.id,
                    name: artist.name,
                  });
                  onClose();
                }}
                className="group flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-zinc-800/50 hover:bg-slate-100 dark:hover:bg-zinc-800 border border-slate-200/60 dark:border-zinc-700/60 hover:border-soso-brand/50 dark:hover:border-soso-brand/50 transition-all cursor-pointer shadow-sm hover:shadow-md"
              >
                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  {/* Avatar */}
                  <div className="relative w-12 h-12 sm:w-14 sm:h-14 rounded-full overflow-hidden bg-slate-200 dark:bg-zinc-700 flex-shrink-0 shadow-sm group-hover:scale-105 transition-transform ring-2 ring-transparent group-hover:ring-soso-brand/40">
                    <img
                      src={displayPic}
                      alt={artist.name}
                      className="w-full h-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.onerror = null;
                        e.currentTarget.src = fallbackPic;
                      }}
                    />
                  </div>

                  {/* Info */}
                  <div className="min-w-0 flex-1">
                    <h3 className="text-sm sm:text-base font-bold truncate group-hover:text-soso-brand transition-colors">
                      {artist.name}
                    </h3>
                    <p className="text-xs text-slate-500 dark:text-zinc-400 font-medium">
                      {artist.nb_fan
                        ? t('{0} слушателей', artist.nb_fan.toLocaleString('ru-RU'))
                        : t('Исполнитель')}
                    </p>
                  </div>
                </div>

                <div className="p-2 rounded-xl text-slate-400 group-hover:text-soso-brand group-hover:translate-x-0.5 transition-all">
                  <ChevronRight className="w-5 h-5" />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
