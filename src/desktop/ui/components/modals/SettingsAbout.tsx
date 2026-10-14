import { useLocale } from '../../../../shared/i18n/useLocale';
import { t } from '../../../../shared/i18n/locale';
import { useEffect, useRef, useState } from 'react';
import { AppVersion } from '../../../../shared/components/settings/AppVersion';
import { PROJECT_REPOSITORY } from '../../../../shared/utils/projectRepository';
import type { AppUpdateStatus } from '../../../../shared/types';

export function SettingsAbout() {
  useLocale();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<AppUpdateStatus | null>(null);
  const request = useRef(0);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  const check = async () => {
    if (checking || !window.electronAPI?.checkAppUpdates) return;
    const id = ++request.current;
    setChecking(true);
    setResult(null);
    try {
      const status = await window.electronAPI.checkAppUpdates();
      if (id === request.current) setResult(status);
    } catch {
      if (id === request.current)
        setResult({
          status: 'error',
          currentVersion: '',
          message: t('Не удалось проверить обновления. Попробуйте снова.'),
        });
    } finally {
      if (id === request.current) setChecking(false);
    }
  };
  return (
    <div className="settings-page settings-about">
      <div className="settings-page-heading">
        <h3>SoSo Music</h3>
        <p>{t('Музыкальный плеер для Windows и Android')}</p>
      </div>
      <section className="settings-section" aria-label={t('Проект и обновления')}>
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{t('Репозиторий')}</strong>
            <span>CatJAM223 / SoSo-Music</span>
          </div>
          <a
            href={PROJECT_REPOSITORY}
            target="_blank"
            rel="noopener noreferrer"
            className="settings-action"
          >
            {t('Открыть GitHub')}
          </a>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{t('Обновления')}</strong>
            <span>
              {t(
                'Новые релизы проверяются автоматически каждые 90 секунд. Можно проверить вручную.',
              )}
            </span>
          </div>
          <button
            type="button"
            className="settings-action"
            disabled={checking || !window.electronAPI?.checkAppUpdates}
            onClick={() => void check()}
          >
            {checking ? t('Проверяем…') : t('Проверить обновления')}
          </button>
        </div>
        {result && (
          <div
            className={'settings-feedback' + (result.status === 'error' ? ' error' : '')}
            role="status"
            aria-live="polite"
          >
            {t(result.message)}
            {result.status === 'available' && result.releaseUrl && (
              <a
                className="settings-action settings-action-primary settings-update-link"
                href={result.releaseUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t('Открыть релиз')}
              </a>
            )}
          </div>
        )}
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{t('Лицензия')}</strong>
            <span>{t('MIT · использование с сохранением авторства')}</span>
          </div>
        </div>
      </section>
      <AppVersion />
    </div>
  );
}
