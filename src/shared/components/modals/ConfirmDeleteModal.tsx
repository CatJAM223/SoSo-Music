import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import React from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  itemName?: string;
  description?: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
}

function restoreWindowFocus(): void {
  setTimeout(() => {
    window.focus();
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && activeElement !== document.body)
      activeElement.blur();
  }, 50);
}

export const ConfirmDeleteModal: React.FC<ConfirmDeleteModalProps> = ({
  isOpen,
  title,
  itemName,
  description,
  confirmText = t('Удалить'),
  onConfirm,
  onClose,
}) => {
  useLocale();
  const [error, setError] = React.useState('');
  const [isConfirming, setIsConfirming] = React.useState(false);

  const handleClose = React.useCallback(() => {
    if (isConfirming) return;
    onClose();
    restoreWindowFocus();
  }, [isConfirming, onClose]);

  const handleConfirm = React.useCallback(async () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t('Не удалось выполнить действие. Попробуйте снова.'),
      );
      console.error('Confirm error in ConfirmDeleteModal:', err);
    } finally {
      setIsConfirming(false);
      restoreWindowFocus();
    }
  }, [isConfirming, onConfirm, onClose]);

  React.useEffect(() => {
    if (isOpen) setError('');
  }, [isOpen]);

  React.useEffect(() => {
    if (isOpen) {
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          handleClose();
        }
      };
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [isOpen, handleClose]);

  if (!isOpen) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in select-none"
    >
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={handleClose} />

      {/* Modal Dialog Card */}
      <div className="relative z-10 w-full max-w-md bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center gap-4 transform transition-all animate-fade-in">
        {/* Close (X) button */}
        <button
          type="button"
          aria-label={t('Закрыть')}
          onClick={handleClose}
          disabled={isConfirming}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>

        {error && (
          <p role="alert" className="w-full text-sm text-rose-500 mt-5">
            {error}
          </p>
        )}

        {/* Warning Icon Badge */}
        <div className="w-14 h-14 rounded-2xl bg-rose-500/15 text-rose-500 flex items-center justify-center shadow-inner mt-2">
          <Trash2 className="w-7 h-7" />
        </div>

        {/* Title & Description */}
        <div className="space-y-2 max-w-sm">
          <h3 className="text-lg font-black text-slate-900 dark:text-white tracking-tight">
            {title}
          </h3>
          <p className="text-sm text-slate-600 dark:text-zinc-400 leading-relaxed">
            {description ? (
              description
            ) : (
              <>
                {t('Вы уверены, что хотите удалить плейлист')}{' '}
                {itemName ? (
                  <strong className="text-slate-900 dark:text-white font-bold">«{itemName}»</strong>
                ) : (
                  t('этот плейлист')
                )}
                {t('? Это действие необратимо.')}
              </>
            )}
          </p>
        </div>

        {/* Action Buttons */}
        <div className="w-full flex items-center justify-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleClose}
            disabled={isConfirming}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold text-slate-700 dark:text-zinc-300 bg-slate-100 dark:bg-zinc-800 hover:bg-slate-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50"
          >
            {t('Отмена')}
          </button>
          <button
            type="button"
            disabled={isConfirming}
            onClick={handleConfirm}
            className="flex-1 py-2.5 px-4 rounded-xl text-sm font-bold text-white bg-rose-600 hover:bg-rose-500 shadow-lg shadow-rose-600/25 transition-all hover:scale-102 disabled:opacity-50"
          >
            {isConfirming ? t('Удаление...') : confirmText}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
};
