import { useLocale } from '../../i18n/useLocale';
import { t, getIntlLocale } from '../../i18n/locale';
import { useLibraryTaste } from '../../hooks/useLibraryTaste';
import { TasteExclusionsSettings } from '../TasteExclusionsSettings';
import { LibraryGenreChart } from './LibraryGenreChart';
import './SettingsLibraryTaste.css';

type Props = { active: boolean };
const dateFormat = new Intl.DateTimeFormat(getIntlLocale(), {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function SettingsLibraryTaste({ active }: Props) {
  useLocale();
  const { report, error, busy, run, retry } = useLibraryTaste(active);
  if (!window.electronAPI?.getLibraryTaste) return null;
  return (
    <section
      className="settings-page settings-section library-taste"
      aria-label={t('Музыкальный вкус Last.fm')}
    >
      <TasteExclusionsSettings />
      <div className="settings-heading-line">
        <h4>Last.fm</h4>
      </div>
      <p className="library-taste-description">
        {t(
          'Жанры любимых треков и треков в плейлистах помогают «Моей волне» подбирать музыку. Любимые учитываются сильнее. Last.fm получает названия и исполнителей.',
        )}
      </p>
      <div className="settings-row">
        <div className="settings-row-copy">
          <strong>{t('Автоматически анализировать новые треки')}</strong>
          <span>{t('При добавлении в любимые или плейлист')}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-label={t('Автоматически анализировать новые треки')}
          aria-checked={report?.autoAnalyze || false}
          disabled={!report || busy}
          className={'settings-switch ' + (report?.autoAnalyze ? 'enabled' : '')}
          onClick={() => void run('auto', !report?.autoAnalyze)}
        >
          <span />
        </button>
      </div>
      {report?.apiKeyConfigured === false && (
        <p className="settings-feedback" role="note">
          {t('Добавьте ключ Last.fm в Настройки → API.')}
        </p>
      )}
      {error && (
        <div className="settings-feedback error" role="alert">
          <p>{t(error)}</p>
          <button type="button" className="settings-action" onClick={retry}>
            {t('Повторить')}
          </button>
        </div>
      )}
      {!report && !error && <p role="status">{t('Загружаем профиль…')}</p>}
      {report && (
        <>
          {report.running && (
            <progress
              className="library-taste-progress"
              max={Math.max(1, report.totalTracks)}
              value={report.processedTracks}
              aria-label={t('Анализ медиатеки Last.fm')}
            />
          )}
          {report.error && (
            <p className="settings-feedback error" role="status">
              {t(report.error)}
            </p>
          )}
          <div className="library-taste-actions">
            <button
              type="button"
              className="settings-action"
              disabled={
                busy ||
                (!report.running && (!report.totalTracks || report.apiKeyConfigured === false))
              }
              onClick={() => void run(report.running ? 'cancel' : 'analyze')}
            >
              {report.running
                ? t('Остановить анализ')
                : report.updatedAt
                  ? t('Обновить анализ')
                  : t('Проанализировать всю музыку')}
            </button>
            {report.updatedAt && (
              <time dateTime={new Date(report.updatedAt).toISOString()}>
                {dateFormat.format(report.updatedAt)}
              </time>
            )}
          </div>
          {report.genres.length > 0 ? (
            <LibraryGenreChart genres={report.genres} />
          ) : (
            <p className="library-taste-empty">
              {!report.totalTracks
                ? t('Добавьте треки в любимые или плейлисты, чтобы определить любимые жанры.')
                : report.running
                  ? t('Ищем жанровые теги в Last.fm…')
                  : report.updatedAt
                    ? t('Last.fm пока не нашёл жанров для этих записей.')
                    : t('Запустите анализ, чтобы увидеть предпочитаемые жанры.')}
            </p>
          )}
        </>
      )}
    </section>
  );
}
