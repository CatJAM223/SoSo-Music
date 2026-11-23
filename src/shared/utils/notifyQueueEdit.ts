import { emitToast } from '../context/ToastContext';
import { t } from '../i18n/locale';

export function notifyQueueEdit(message: string, undo: (() => boolean) | void): void {
  emitToast(
    message,
    'info',
    8000,
    undo
      ? {
          label: t('Отменить'),
          run: () => {
            if (!undo()) emitToast(t('Очередь уже изменилась. Отмена недоступна.'), 'info');
          },
        }
      : undefined,
  );
}
