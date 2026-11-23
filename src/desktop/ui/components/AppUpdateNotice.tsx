import { useId, useState } from 'react';
import { ArrowDownToLine, ChevronDown, ExternalLink, X } from 'lucide-react';
import type { AppUpdateStatus } from '../../../shared/types';
import { useLocale } from '../../../shared/i18n/useLocale';
import { t } from '../../../shared/i18n/locale';
import { PROJECT_REPOSITORY } from '../../../shared/utils/projectRepository';
import './AppUpdateNotice.css';

type Props = { update: AppUpdateStatus; onDismiss: () => void };

export function AppUpdateNotice({ update, onDismiss }: Props) {
  useLocale();
  const [expanded, setExpanded] = useState(false);
  const titleId = useId();
  const detailsId = useId();
  const highlights = update.releaseHighlights;
  const url =
    update.releaseUrl ??
    PROJECT_REPOSITORY + '/releases/tag/v' + encodeURIComponent(update.latestVersion || '');

  return (
    <aside
      className="app-update-notice"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onDismiss();
      }}
    >
      <div className="app-update-row">
        <div className="app-update-copy" role="status">
          <h2 id={titleId}>{t('Доступна версия {0}', update.latestVersion)}</h2>
        </div>
        {highlights ? (
          <button
            type="button"
            className="app-update-expand"
            aria-controls={detailsId}
            aria-expanded={expanded}
            onClick={() => setExpanded((value) => !value)}
          >
            {t(expanded ? 'Свернуть подробности' : 'Подробнее')}
            <ChevronDown size={15} aria-hidden="true" />
          </button>
        ) : (
          <a
            className="app-update-release"
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onDismiss}
          >
            {t('Открыть релиз')}
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        )}
        <button
          type="button"
          className="app-update-close"
          aria-label={t('Позже')}
          onClick={onDismiss}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>
      {highlights && (
        <div
          id={detailsId}
          className="app-update-details"
          data-expanded={expanded}
          inert={!expanded}
        >
          <div className="app-update-details-clip">
            <div className="app-update-details-content">
              <h3>{t('Что нового')}</h3>
              <p>{highlights.summary}</p>
              {highlights.changes.length > 0 && (
                <ul>
                  {highlights.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              )}
              <a
                className="app-update-download"
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={onDismiss}
              >
                <ArrowDownToLine size={16} aria-hidden="true" />
                {t('Скачать на GitHub')}
              </a>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
