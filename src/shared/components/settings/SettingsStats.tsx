import { useLocale } from '../../i18n/useLocale';
import { t, getIntlLocale } from '../../i18n/locale';
import { useEffect, useState } from 'react';
import { platformBridge } from '../../bridge/platformBridge';
import type { ListeningHistoryItem, ListeningStats } from '../../types';

type Props = {
  stats: ListeningStats | null;
  isLoading: boolean;
  lastTrack: ListeningHistoryItem | null;
};

const artistPictures = new Map<string, string>();

function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours > 0
    ? t('{0} ч {1} мин', hours, minutes)
    : minutes > 0
      ? t('{0} мин {1} с', minutes, remaining)
      : t('{0} с', remaining);
}

function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function Artwork({ src, label, round = false }: { src?: string; label: string; round?: boolean }) {
  useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const className = `settings-list-artwork${round ? ' round' : ''}`;
  return src && !failed ? (
    <img className={className} src={src} alt="" loading="lazy" onError={() => setFailed(true)} />
  ) : (
    <span className={`${className} fallback`} aria-hidden="true">
      {label.trim().charAt(0).toLocaleUpperCase('ru')}
    </span>
  );
}

function ArtistAvatar({ artist, picture }: { artist: string; picture?: string }) {
  useLocale();
  const key = artist.trim().toLocaleLowerCase('ru');
  const [fetched, setFetched] = useState(() => artistPictures.get(key) || '');
  useEffect(() => {
    if (picture || artistPictures.has(key)) return;
    let active = true;
    void platformBridge
      .searchArtists(artist, 5)
      .then(({ data }) => {
        const exact = data.find(
          (item) =>
            String(item?.name || '')
              .trim()
              .toLocaleLowerCase('ru') === key,
        );
        const url = String(
          exact?.picture_xl || exact?.picture_big || exact?.picture_medium || exact?.picture || '',
        );
        artistPictures.set(key, url);
        if (active) setFetched(url);
      })
      .catch(() => {
        artistPictures.set(key, '');
      });
    return () => {
      active = false;
    };
  }, [artist, key, picture]);
  return <Artwork src={picture || fetched} label={artist} round />;
}

export function SettingsStats({ stats, isLoading, lastTrack }: Props) {
  const numberFormat = new Intl.NumberFormat(getIntlLocale());
  const dateFormat = new Intl.DateTimeFormat(getIntlLocale(), { day: 'numeric', month: 'long' });
  useLocale();
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const activity = new Map(
    stats?.weekly?.activity?.map((item) => [item.day, item]) ||
      stats?.activity?.map(({ day, plays }) => [
        day.slice(0, 10),
        { day, plays, measuredSeconds: 0 },
      ]) ||
      [],
  );
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 6 + index);
    const key = localDayKey(date);
    const entry = activity.get(key);
    return {
      key,
      date,
      label: new Intl.DateTimeFormat(getIntlLocale(), { weekday: 'short' }).format(date),
      plays: entry?.plays || 0,
      measuredSeconds: entry?.measuredSeconds || 0,
    };
  });
  const max = Math.max(1, ...days.map(({ plays }) => plays));
  const yValues = days.map(({ plays }) => 142 - (plays / max) * 120);
  const points = days.map((_, index) => `${(590 * (index + 0.5)) / 7},${yValues[index]}`).join(' ');
  const week = stats?.weekly;
  const weekPlays = week?.plays ?? days.reduce((sum, day) => sum + day.plays, 0);
  const weekTracks = week?.topTracks || [];
  const weekArtists = week?.topArtists || [];
  const weekStart = days[0].date;
  const recentTrack =
    lastTrack?.played_at &&
    new Date(lastTrack.played_at) >=
      new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate())
      ? lastTrack
      : null;

  return (
    <div className="settings-page settings-stats-page">
      <div className="settings-stats-period">
        <span>{t('Последние 7 дней')}</span>
        {isLoading && <span className="settings-loading">{t('Обновление…')}</span>}
      </div>
      <div className="settings-stats-summary">
        <div>
          <span>{t('Время')}</span>
          <strong className="tabular-nums">{formatTime(week?.measuredSeconds || 0)}</strong>
        </div>
        <div>
          <span>{t('Прослушивания')}</span>
          <strong className="tabular-nums">{numberFormat.format(weekPlays)}</strong>
        </div>
        <div>
          <span>{t('Треки')}</span>
          <strong className="tabular-nums">{numberFormat.format(week?.uniqueTracks || 0)}</strong>
        </div>
        <div>
          <span>{t('Исполнители')}</span>
          <strong className="tabular-nums">{numberFormat.format(week?.uniqueArtists || 0)}</strong>
        </div>
      </div>
      <div className="settings-stats-grid">
        <section className="settings-section settings-stats-feature">
          <div className="settings-heading-line">
            <h4>{t('Активность')}</h4>
            <span>
              {numberFormat.format(weekPlays)} {t(' прослушиваний')}
            </span>
          </div>
          <div
            className="settings-stats-chart"
            role="group"
            aria-label={t('Прослушивания по дням')}
          >
            <svg viewBox="0 0 590 155" preserveAspectRatio="none" aria-hidden="true">
              <polyline
                points={points}
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <div className="settings-chart-hit-areas">
              {days.map((day, index) => (
                <button
                  key={day.key}
                  type="button"
                  aria-label={t(
                    '{0}: {1} прослушиваний, {2}',
                    dateFormat.format(day.date),
                    day.plays,
                    formatTime(day.measuredSeconds),
                  )}
                >
                  <span
                    className="settings-chart-dot"
                    style={{ top: `${(yValues[index] / 155) * 100}%` }}
                  />
                  <span className="settings-chart-tooltip">
                    <strong>{dateFormat.format(day.date)}</strong>
                    <span>
                      {day.plays} {t(' прослушиваний')}
                    </span>
                    <span>{formatTime(day.measuredSeconds)}</span>
                  </span>
                </button>
              ))}
            </div>
            <div className="settings-chart-labels">
              {days.map((day) => (
                <span key={day.key}>{day.label}</span>
              ))}
            </div>
          </div>
          <div className="settings-stats-metrics">
            <div>
              <strong className="tabular-nums">{week?.completions || 0}</strong>
              <span>{t('дослушано')}</span>
            </div>
            <div>
              <strong className="tabular-nums">{week?.repeats || 0}</strong>
              <span>{t('повторов')}</span>
            </div>
            <div>
              <strong className="tabular-nums">{week?.likes || 0}</strong>
              <span>{t('в любимых')}</span>
            </div>
          </div>
          <div className="settings-last-track">
            <h4>{t('Последний трек')}</h4>
            {recentTrack ? (
              <div className="settings-track-row">
                <Artwork src={recentTrack.cover_url} label={recentTrack.title} />
                <div>
                  <strong>{recentTrack.title}</strong>
                  <span>{recentTrack.artist}</span>
                </div>
              </div>
            ) : (
              <p>{t('За эту неделю пока нет треков')}</p>
            )}
          </div>
        </section>
        <div className="settings-stats-lists">
          <section className="settings-section">
            <h4>{t('Треки')}</h4>
            {weekTracks.length ? (
              <ol>
                {weekTracks.slice(0, 5).map((track, index) => (
                  <li key={track.id}>
                    <span className="settings-list-rank tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <Artwork src={track.cover_url} label={track.title} />
                    <div>
                      <strong>{track.title}</strong>
                      <small>{track.artist}</small>
                    </div>
                    <em className="tabular-nums">{track.play_count}</em>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="settings-empty">{t('Пока нет данных')}</p>
            )}
          </section>
          <section className="settings-section">
            <h4>{t('Исполнители')}</h4>
            {weekArtists.length ? (
              <ol>
                {weekArtists.slice(0, 5).map((artist, index) => (
                  <li key={artist.artist}>
                    <span className="settings-list-rank tabular-nums">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <ArtistAvatar artist={artist.artist} picture={artist.picture_url} />
                    <div>
                      <strong>{artist.artist}</strong>
                    </div>
                    <em className="tabular-nums">{artist.plays}</em>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="settings-empty">{t('Пока нет данных')}</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
