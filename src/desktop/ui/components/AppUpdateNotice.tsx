import { useRef } from 'react';
import { X, Download } from 'lucide-react';
import { createPortal } from 'react-dom';
import type { AppUpdateStatus } from '../../../shared/types';
import { useDialogFocus } from '../../../shared/hooks/useDialogFocus';
import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { PROJECT_REPOSITORY } from '../../../shared/utils/projectRepository';
import './AppUpdateNotice.css';
type Props = { update: AppUpdateStatus; onDismiss: () => void };
export function AppUpdateNotice({ update, onDismiss }: Props) {
  useLocale();
  const panel = useRef<HTMLDivElement>(null);
  useDialogFocus(panel, onDismiss);
  const url =
    PROJECT_REPOSITORY + '/releases/tag/v' + encodeURIComponent(update.latestVersion || '');
  return createPortal(
    <div className="app-update-shade">
      <div
        ref={panel}
        className="app-update-notice"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
      >
        <button className="app-update-close" onClick={onDismiss} aria-label={t('Закрыть')}>
          <X size={22} />
        </button>
        <header>
          <span className="app-update-badge">{t('Новое обновление')}</span>
          <h2 id="app-update-title">{t('Вышло новое обновление')}</h2>
          <p>{t('Версия {0}', update.latestVersion)}</p>
        </header>
        <div className="app-update-content">
          <svg
            className="app-update-wave"
            viewBox="0 0 500 220"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {Array.from({ length: 28 }, (_, i) => (
              <path
                key={i}
                d={
                  'M-20 ' +
                  (118 + i * 1.5) +
                  ' C70 ' +
                  (168 - i * 0.8) +
                  ',90 ' +
                  (30 + i * 2.4) +
                  ',165 ' +
                  (100 + i * 0.8) +
                  ' S245 ' +
                  (185 - i * 2.1) +
                  ',300 ' +
                  (135 - i * 0.8) +
                  ' S385 ' +
                  (-5 + i * 2.4) +
                  ',460 ' +
                  (75 + i * 1.5) +
                  ' S530 ' +
                  (130 + i * 2) +
                  ',550 ' +
                  (100 + i)
                }
                fill="none"
                stroke="currentColor"
                strokeOpacity={0.12 + (1 - Math.abs(i - 13.5) / 13.5) * 0.5}
              />
            ))}
          </svg>
        </div>
        <footer>
          <div className="app-update-actions">
            <button
              data-initial-focus
              className="app-update-download"
              onClick={() => {
                window.open(url, '_blank', 'noopener,noreferrer');
                onDismiss();
              }}
            >
              <Download size={18} />
              {t('Скачать обновление')}
            </button>
            <button onClick={onDismiss}>{t('Позже')}</button>
          </div>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
