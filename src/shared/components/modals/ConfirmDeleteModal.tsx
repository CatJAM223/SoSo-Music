import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import React from 'react';
import { createPortal } from 'react-dom';
import { Trash2, X } from 'lucide-react';
import { useNativeModal } from '../../hooks/useNativeModal';
import './ConfirmDeleteModal.css';

interface ConfirmDeleteModalProps {
  isOpen: boolean;
  title: string;
  itemName?: string;
  description?: string;
  confirmText?: string;
  onConfirm: () => void;
  onClose: () => void;
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
  const dialog = useNativeModal();
  const titleId = React.useId();

  const handleClose = React.useCallback(() => {
    if (isConfirming) return;
    onClose();
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
    }
  }, [isConfirming, onConfirm, onClose]);

  React.useEffect(() => {
    if (isOpen) setError('');
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <dialog
      ref={dialog}
      closedby="any"
      aria-labelledby={titleId}
      aria-busy={isConfirming}
      className="confirm-delete-dialog fixed inset-0 m-auto bg-transparent p-0 animate-fade-in select-none"
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        handleClose();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') event.stopPropagation();
      }}
    >
      <div className="relative w-full bg-white dark:bg-[#18181b] border border-slate-200 dark:border-zinc-800 rounded-3xl p-6 flex flex-col items-center text-center gap-4">
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
          <h3
            id={titleId}
            className="text-lg font-black text-slate-900 dark:text-white tracking-tight"
          >
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
        <button
          type="button"
          aria-label={t('Закрыть')}
          onClick={handleClose}
          disabled={isConfirming}
          className="absolute top-4 right-4 p-1.5 rounded-xl text-slate-400 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-zinc-800 transition-colors disabled:opacity-50"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </dialog>,
    document.body,
  );
};
