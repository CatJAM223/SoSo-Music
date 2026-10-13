import { useLocale } from '../i18n/useLocale';
import { t, getIntlLocale } from '../i18n/locale';
import { Activity, Clock3, Heart, Loader2, Music2, Repeat } from 'lucide-react';
import type { ListeningStats } from '../types/index.ts';

type Props = {
  stats: ListeningStats | null;
  isLoading: boolean;
};

const numberFormats = { ru: new Intl.NumberFormat('ru-RU'), en: new Intl.NumberFormat('en-US') };
const surfaceClass =
  'rounded-2xl border border-slate-200 dark:border-zinc-800 bg-white/60 dark:bg-zinc-900/50';

function formatNumber(value: number): string {
  return numberFormats[getIntlLocale() === 'en-US' ? 'en' : 'ru'].format(
    Number.isFinite(value) ? value : 0,
  );
}

function formatListenTime(hours: number, minutes = 0, measuredSeconds?: number): string {
  const totalSeconds = Math.max(0, Math.floor(measuredSeconds ?? (hours * 60 + minutes) * 60));
  const totalHours = Math.floor(totalSeconds / 3600);
  const remainingMinutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (totalHours > 0)
    return t('{0} ч {1} мин {2} с', formatNumber(totalHours), remainingMinutes, seconds);
  if (remainingMinutes > 0) return t('{0} мин {1} с', formatNumber(remainingMinutes), seconds);
  return t('{0} с', formatNumber(seconds));
}

function formatRussianCount(value: number, forms: [string, string, string]): string {
  const absolute = Math.abs(value);
  const lastTwo = absolute % 100;
  const last = absolute % 10;
  const form =
    lastTwo >= 11 && lastTwo <= 14
      ? forms[2]
      : last === 1
        ? forms[0]
        : last >= 2 && last <= 4
          ? forms[1]
          : forms[2];
  return `${formatNumber(value)} ${form}`;
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDayLabel(key: string): string {
  const date = new Date(`${key}T12:00:00`);
  return new Intl.DateTimeFormat(getIntlLocale(), { day: 'numeric', month: 'short' }).format(date);
}

function SectionHeading({ title, detail }: { title: string; detail?: string }) {
  useLocale();
  return (
    <div className="flex items-baseline justify-between gap-3">
      <h3 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h3>
      {detail && <span className="text-xs text-slate-500 dark:text-zinc-400">{detail}</span>}
    </div>
  );
}

function ActivityChart({ activity }: { activity: ListeningStats['activity'] }) {
  useLocale();
  const byDay = new Map(activity.map(({ day, plays }) => [day.slice(0, 10), Number(plays) || 0]));
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const days = Array.from({ length: 14 }, (_, index) => {
    const date = new Date(today);
    date.setDate(today.getDate() - 13 + index);
    const key = dayKey(date);
    return { key, date, plays: byDay.get(key) || 0 };
  });
  const maxPlays = Math.max(1, ...days.map((day) => day.plays));
  const totalPlays = days.reduce((sum, day) => sum + day.plays, 0);
  const peak = days.reduce((best, day) => (day.plays > best.plays ? day : best), days[0]);

  return (
    <section className={`${surfaceClass} p-4 sm:p-5`}>
      <SectionHeading
        title={t('Прослушивания по дням')}
        detail={t('{0} за 14 дней', formatNumber(totalPlays))}
      />
      <div
        className="mt-5"
        role="img"
        aria-label={t('Прослушивания за последние 14 дней: {0} треков', formatNumber(totalPlays))}
      >
        <div className="flex h-24 items-end gap-1 sm:h-28 sm:gap-1.5">
          {days.map(({ key, plays }) => {
            const height = plays > 0 ? Math.max(8, Math.round((plays / maxPlays) * 96)) : 2;
            return (
              <div
                key={key}
                className="flex h-full min-w-0 flex-1 items-end"
                title={t('{0}: {1} треков', key, formatNumber(plays))}
              >
                <div
                  className={`w-full rounded-t-sm ${plays > 0 ? 'bg-soso-brand' : 'bg-slate-200 dark:bg-zinc-800'}`}
                  style={{ height: `${height}px` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-2 flex justify-between text-[10px] text-slate-500 dark:text-zinc-500">
          <span>{formatDayLabel(days[0].key)}</span>
          <span>{formatDayLabel(days[6].key)}</span>
          <span>{formatDayLabel(days[13].key)}</span>
        </div>
        {peak.plays > 0 && (
          <p className="mt-2 text-xs text-slate-600 dark:text-zinc-400">
            {t('Пик: ')}
            {formatDayLabel(peak.key)} ·{' '}
            {formatRussianCount(peak.plays, [
              t('прослушивание'),
              t('прослушивания'),
              t('прослушиваний'),
            ])}
          </p>
        )}
      </div>
    </section>
  );
}

function TrackList({ tracks }: { tracks: ListeningStats['topTracks'] }) {
  useLocale();
  const maxPlays = Math.max(1, ...tracks.map((track) => track.play_count));

  return (
    <section className={`${surfaceClass} p-4 sm:p-5`}>
      <SectionHeading title={t('Треки')} detail={t('Чаще всего слушал')} />
      {tracks.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-zinc-400">{t('Пока нет данных')}</p>
      ) : (
        <ol className="mt-3">
          {tracks.slice(0, 10).map((track, index) => (
            <li
              key={track.id}
              className="relative flex min-h-14 items-center gap-3 border-b border-slate-200/70 py-2 last:border-b-0 dark:border-zinc-800/80"
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-slate-400 dark:text-zinc-500">
                {String(index + 1).padStart(2, '0')}
              </span>
              {track.cover_url ? (
                <img
                  src={track.cover_url}
                  alt=""
                  className="h-9 w-9 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
                  <Music2 className="h-4 w-4" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900 dark:text-zinc-100">
                  {track.title}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-zinc-400">
                  {track.artist}
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-soso-brand/70"
                    style={{ width: `${Math.max(4, (track.play_count / maxPlays) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="shrink-0 pl-1 text-xs tabular-nums text-slate-500 dark:text-zinc-400">
                {formatNumber(track.play_count)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function ArtistList({ artists }: { artists: ListeningStats['topArtists'] }) {
  useLocale();
  const maxPlays = Math.max(1, ...artists.map((artist) => artist.plays));

  return (
    <section className={`${surfaceClass} p-4 sm:p-5`}>
      <SectionHeading title={t('Исполнители')} detail={t('Чаще всего слушал')} />
      {artists.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-zinc-400">{t('Пока нет данных')}</p>
      ) : (
        <ol className="mt-3">
          {artists.slice(0, 8).map((artist, index) => (
            <li
              key={artist.artist}
              className="flex min-h-14 items-center gap-3 border-b border-slate-200/70 py-2 last:border-b-0 dark:border-zinc-800/80"
            >
              <span className="w-5 shrink-0 text-right font-mono text-xs tabular-nums text-slate-400 dark:text-zinc-500">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-900 dark:text-zinc-100">
                  {artist.artist}
                </div>
                <div className="mt-1 h-0.5 overflow-hidden rounded-full bg-slate-100 dark:bg-zinc-800">
                  <div
                    className="h-full rounded-full bg-soso-brand/70"
                    style={{ width: `${Math.max(4, (artist.plays / maxPlays) * 100)}%` }}
                  />
                </div>
              </div>
              <span className="shrink-0 pl-1 text-right text-xs tabular-nums text-slate-500 dark:text-zinc-400">
                {formatNumber(artist.plays)}
                {artist.sharePercent !== undefined && (
                  <span className="ml-1 text-slate-400 dark:text-zinc-500">
                    · {artist.sharePercent}%
                  </span>
                )}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function ListeningStatsPanel({ stats, isLoading }: Props) {
  useLocale();
  const hasStats = Boolean(stats && (stats.totalPlays > 0 || (stats.measuredSeconds || 0) > 0));

  return (
    <div className="space-y-4 sm:space-y-5">
      <header className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-white">
            {t('Статистика')}
          </h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">{t('За всё время')}</p>
        </div>
        {isLoading && (
          <Loader2
            className="mt-1 h-4 w-4 animate-spin text-slate-400"
            aria-label={t('Обновление статистики')}
          />
        )}
      </header>

      {!hasStats || !stats ? (
        <div
          className={`${surfaceClass} flex min-h-36 flex-col items-center justify-center px-5 py-8 text-center`}
        >
          <Music2 className="h-5 w-5 text-slate-400 dark:text-zinc-500" />
          <p className="mt-3 text-sm font-medium text-slate-800 dark:text-zinc-200">
            {isLoading ? t('Загружаем статистику…') : t('Пока нет прослушиваний')}
          </p>
          {!isLoading && (
            <p className="mt-1 max-w-xs text-xs text-slate-500 dark:text-zinc-400">
              {t('После прослушивания треков здесь появятся ваши цифры и чарты.')}
            </p>
          )}
        </div>
      ) : (
        <>
          <section className={`${surfaceClass} p-4 sm:p-5`}>
            <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <div className="text-xs font-medium text-slate-500 dark:text-zinc-400">
                  {t('Фактическое время прослушивания · с этого обновления')}
                </div>
                <div className="mt-2 flex items-baseline gap-2 text-slate-950 dark:text-white">
                  <Clock3 className="mr-1 h-5 w-5 text-slate-400 dark:text-zinc-500" />
                  <span className="text-3xl font-semibold tracking-tight sm:text-4xl">
                    {formatListenTime(
                      stats.approxHours,
                      stats.approxMinutes,
                      stats.measuredSeconds,
                    )}
                  </span>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 border-t border-slate-200 pt-4 sm:min-w-[52%] sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0 dark:border-zinc-800">
                <div>
                  <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatNumber(stats.totalPlays)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    {t('прослушиваний')}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatNumber(stats.uniqueTracks)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    {t('треков')}
                  </div>
                </div>
                <div>
                  <div className="text-lg font-semibold tabular-nums text-slate-900 dark:text-white">
                    {formatNumber(stats.uniqueArtists)}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-500 dark:text-zinc-400">
                    {t('исполнителей')}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-3 divide-x divide-slate-200 rounded-xl border border-slate-200 dark:divide-zinc-800 dark:border-zinc-800">
            <div className="px-3 py-3 sm:px-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                <Heart className="h-3.5 w-3.5" /> {t(' В любимых')}
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatNumber(stats.likedCount)}
              </div>
            </div>
            <div className="px-3 py-3 sm:px-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                <Activity className="h-3.5 w-3.5" /> {t(' Дослушано')}
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatNumber(stats.completionRate || 0)}%
              </div>
            </div>
            <div className="px-3 py-3 sm:px-4">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-zinc-400">
                <Repeat className="h-3.5 w-3.5" /> {t(' Повторы')}
              </div>
              <div className="mt-1 text-sm font-semibold tabular-nums text-slate-900 dark:text-white">
                {formatNumber(stats.totalRepeats || 0)}
              </div>
            </div>
          </div>

          {stats.mostReplayedTrack && (
            <section className={`${surfaceClass} flex items-center gap-3 p-3.5 sm:px-4`}>
              {stats.mostReplayedTrack.cover_url ? (
                <img
                  src={stats.mostReplayedTrack.cover_url}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-md object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-400 dark:bg-zinc-800 dark:text-zinc-500">
                  <Music2 className="h-5 w-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="text-[11px] text-slate-500 dark:text-zinc-400">
                  {t('Чаще всего повторялся')}
                </div>
                <div className="truncate text-sm font-medium text-slate-900 dark:text-white">
                  {stats.mostReplayedTrack.title}
                </div>
                <div className="truncate text-xs text-slate-500 dark:text-zinc-400">
                  {stats.mostReplayedTrack.artist}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 text-xs tabular-nums text-slate-500 dark:text-zinc-400">
                <Repeat className="h-3.5 w-3.5" />
                {formatRussianCount(stats.mostReplayedTrack.repeat_count, [
                  t('раз'),
                  t('раза'),
                  t('раз'),
                ])}
              </div>
            </section>
          )}

          <ActivityChart activity={stats.activity} />

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <TrackList tracks={stats.topTracks} />
            <ArtistList artists={stats.topArtists} />
          </div>
        </>
      )}
    </div>
  );
}
