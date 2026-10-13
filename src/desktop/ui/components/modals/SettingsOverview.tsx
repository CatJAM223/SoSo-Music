import { useLocale } from '../../../../shared/i18n/useLocale';
import { t, getIntlLocale } from '../../../../shared/i18n/locale';
import type { ListeningStats } from '../../../../shared/types';

type Props = {
  stats: ListeningStats | null;
  themeLabel: string;
  cacheLabel: string;
  crossfadeLabel: string;
  integrationsLabel: string;
};

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  return hours > 0
    ? t('{0} ч {1} мин', hours, minutes)
    : minutes > 0
      ? t('{0} мин', minutes)
      : t('{0} с', safe);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function SettingsSummary({ label, detail }: { label: string; detail: string }) {
  useLocale();
  return (
    <div className="settings-overview-row">
      <span className="settings-overview-row-label">{label}</span>
      <span className="settings-overview-value">{detail}</span>
    </div>
  );
}

export function SettingsOverview({
  stats,
  themeLabel,
  cacheLabel,
  crossfadeLabel,
  integrationsLabel,
}: Props) {
  useLocale();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const activity = new Map(
    stats?.weekly?.activity?.map(({ day, plays }) => [day, plays]) ||
      stats?.activity?.map(({ day, plays }) => [day.slice(0, 10), plays]) ||
      [],
  );
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    const key = localDayKey(date);
    return {
      key,
      label: new Intl.DateTimeFormat(getIntlLocale(), { weekday: 'short' }).format(date),
      plays: activity.get(key) || 0,
    };
  });
  const max = Math.max(1, ...days.map(({ plays }) => plays));
  const points = days
    .map(({ plays }, index) => `${12 + index * 76},${80 - (plays / max) * 64}`)
    .join(' ');
  const weekPlays = stats?.weekly?.plays ?? days.reduce((sum, day) => sum + day.plays, 0);

  return (
    <div className="settings-overview">
      <div className="settings-overview-hero">
        <div className="settings-overview-today">
          <span>{t('Сегодня')}</span>
          <strong>{formatTime(stats?.todaySeconds || 0)}</strong>
        </div>
        <div
          className="settings-overview-mini-chart"
          role="img"
          aria-label={t('{0} прослушиваний за последние 7 дней', weekPlays)}
        >
          <span>
            {weekPlays} {t(' за 7 дней')}
          </span>
          <svg viewBox="0 0 480 90" preserveAspectRatio="none" aria-hidden="true">
            <polyline
              points={points}
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          <div>
            <span>{days[0].label}</span>
            <span>{days[3].label}</span>
            <span>{days[6].label}</span>
          </div>
        </div>
      </div>
      <div className="settings-overview-columns">
        <section aria-label={t('Прослушивание')}>
          <h3>{t('Прослушивание')}</h3>
          <SettingsSummary label={t('Плавный переход')} detail={crossfadeLabel} />
          <SettingsSummary label={t('За неделю')} detail={String(weekPlays)} />
        </section>
        <section aria-label={t('Оформление и данные')}>
          <h3>{t('Оформление и данные')}</h3>
          <SettingsSummary label={t('Тема')} detail={themeLabel} />
          <SettingsSummary label="Discord" detail={integrationsLabel} />
          <SettingsSummary label={t('Офлайн хранилище')} detail={cacheLabel} />
        </section>
      </div>
    </div>
  );
}
