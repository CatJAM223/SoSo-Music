import { useLocale } from '../../../../shared/i18n/useLocale';
import { t } from '../../../../shared/i18n/locale';
import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ListMusic, Plus, AlertCircle } from 'lucide-react';
import { Playlist } from '../../../../shared/types';

interface CreatePlaylistModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPlaylistCreated: () => void;
}

export const CreatePlaylistModal: React.FC<CreatePlaylistModalProps> = ({
  isOpen,
  onClose,
  onPlaylistCreated,
}) => {
  useLocale();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [existingPlaylists, setExistingPlaylists] = useState<Playlist[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const onCloseRef = React.useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setDescription('');
      // Load current playlists to check for duplicates
      if (window.electronAPI?.getPlaylists) {
        window.electronAPI.getPlaylists().then(setExistingPlaylists).catch(console.error);
      }

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onCloseRef.current();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isDuplicate = existingPlaylists.some(
    (p) => p.name.trim().toLowerCase() === name.trim().toLowerCase(),
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || isDuplicate) return;

    setIsLoading(true);
    try {
      if (window.electronAPI?.createPlaylist) {
        await window.electronAPI.createPlaylist(name.trim(), description.trim());
        setName('');
        setDescription('');
        onPlaylistCreated();
        onClose();
      }
    } catch (err) {
      console.error('Error creating playlist:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 bg-black/70 backdrop-blur-md z-[120] flex items-center justify-center p-4 animate-fade-in">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('Создать плейлист')}
        className="bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 rounded-3xl w-full max-w-md p-6 shadow-2xl"
      >
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-soso-brand/20 text-soso-brand flex items-center justify-center">
              <ListMusic className="w-5 h-5" />
            </div>
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {t('Создать плейлист')}
            </h3>
          </div>
          <button
            type="button"
            aria-label={t('Закрыть')}
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5">
              {t('Название плейлиста ')}
              <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('Например: Мой вечерний микс')}
              className={`w-full px-4 py-2.5 rounded-xl text-sm placeholder-slate-400 dark:placeholder-zinc-500 transition-all ${
                isDuplicate
                  ? 'border border-rose-500 ring-2 ring-rose-500/30 text-rose-600 dark:text-rose-400 bg-rose-500/10'
                  : 'soso-search-input soso-search-input-rounded'
              }`}
            />
            {isDuplicate && (
              <p className="flex items-center gap-1.5 text-xs text-rose-500 font-semibold mt-1.5 animate-fade-in">
                <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                <span>{t('Плейлист с таким названием уже существует')}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-400 mb-1.5">
              {t('Описание (опционально)')}
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t('Добавьте описание или настроение...')}
              className="w-full px-4 py-2 bg-slate-50 dark:bg-zinc-800/90 border border-slate-200 dark:border-zinc-700 rounded-xl text-sm text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-soso-brand resize-none"
            />
          </div>

          <div className="pt-3 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors"
            >
              {t('Отмена')}
            </button>
            <button
              type="submit"
              disabled={isLoading || !name.trim() || isDuplicate}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-soso-brand hover:bg-soso-brand-light text-black font-bold text-sm shadow-lg shadow-soso-brand/20 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Plus className="w-4 h-4" />
              <span>{t('Создать')}</span>
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
};
