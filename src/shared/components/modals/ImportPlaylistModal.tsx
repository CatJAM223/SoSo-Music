import { useLocale } from '../../i18n/useLocale';
import { t } from '../../i18n/locale';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDownToLine, Check, ExternalLink, Loader2, X } from 'lucide-react';
import { platformBridge } from '../../bridge/platformBridge.ts';
import { usePlaylistImport } from '../../hooks/usePlaylistImport.ts';
import type { ImportSearchSource } from '../../types/playlistImport.ts';

type Props = { onClose: () => void; onSaved: () => void };
const sourceName = (source?: string) => (source === 'soundcloud' ? 'SoundCloud' : 'YouTube Music');

export function ImportPlaylistModal({ onClose, onSaved }: Props) {
  useLocale();
  const [url, setUrl] = useState('');
  const [priority, setPriority] = useState<ImportSearchSource>('youtube');
  const [name, setName] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const { state, actions } = usePlaylistImport(onSaved);
  const busy = ['loading', 'matching', 'saving'].includes(state.phase);
  const accepted = state.matches.filter((match) => match?.track).length;
  const uncertain = state.matches.filter(
    (match) => match?.status === 'review' && !match.track,
  ).length;
  const missing = state.matches.filter(
    (match) => match && ['missing', 'error'].includes(match.status),
  ).length;
  const total = state.playlist?.tracks.length || 0;
  const pages = Math.max(1, Math.ceil(total / 50));

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => previousFocus?.focus();
  }, []);

  function close() {
    if (state.phase === 'saving') return;
    actions.stop();
    onClose();
  }

  function downloadReport() {
    if (!state.playlist) return;
    const report = {
      playlist: state.playlist.title,
      url: state.playlist.url,
      priority: state.priority,
      tracks: state.playlist.tracks.map((original, index) => {
        const match = state.matches[index];
        return {
          original,
          status: match?.track ? 'selected' : match?.status || 'pending',
          selected: match?.track
            ? {
                id: match.track.id,
                title: match.track.title,
                artist: match.track.artist.name,
                source: match.track.source,
              }
            : null,
          error: match?.error,
        };
      }),
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: 'application/json;charset=utf-8',
    });
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = 'soso-playlist-import.json';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 backdrop-blur-md p-3 sm:p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="playlist-import-title"
        className="flex max-h-[90dvh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white text-slate-900 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          }
          if (event.key === 'Tab') {
            const items = Array.from(
              dialogRef.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex="0"]',
              ) || [],
            );
            const first = items[0];
            const last = items[items.length - 1];
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 p-5 dark:border-zinc-800">
          <div>
            <h2 id="playlist-import-title" className="text-lg font-bold">
              {t('Перенести плейлист')}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
              {t('Из Яндекс Музыки или VK Музыки')}
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            disabled={state.phase === 'saving'}
            aria-label={t('Закрыть импорт')}
            className="rounded-lg p-2 hover:bg-slate-100 disabled:opacity-40 dark:hover:bg-zinc-800"
          >
            <X size={20} />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto p-5">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setPage(0);
              setName(null);
              void actions.load(url);
            }}
            className="space-y-3"
          >
            <label className="block text-sm font-semibold" htmlFor="playlist-import-url">
              {t('Ссылка на публичный плейлист')}
            </label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                id="playlist-import-url"
                type="url"
                required
                maxLength={2048}
                value={url}
                onChange={(event) => setUrl(event.target.value)}
                disabled={busy || state.phase === 'saved'}
                placeholder={t(
                  'https://music.yandex.ru/playlists/… или https://vk.ru/audio_playlist…',
                )}
                className="min-w-0 flex-1 rounded-xl border border-slate-300 bg-transparent px-3 py-2.5 text-sm disabled:opacity-50 dark:border-zinc-700"
              />
              <button
                type="submit"
                disabled={busy || state.phase === 'saved'}
                className="rounded-xl bg-slate-100 px-4 py-2.5 text-sm font-semibold disabled:opacity-50 dark:bg-zinc-800"
              >
                {t('Загрузить')}
              </button>
            </div>
          </form>
          <fieldset disabled={busy || state.phase === 'saved'}>
            <legend className="mb-2 text-sm font-semibold">
              {t('Где искать в первую очередь')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {(['soundcloud', 'youtube'] as const).map((source) => (
                <label
                  key={source}
                  className={`flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-3 text-sm ${priority === source ? 'border-soso-brand bg-soso-brand/10' : 'border-slate-200 dark:border-zinc-700'}`}
                >
                  <input
                    type="radio"
                    name="playlist-import-priority"
                    value={source}
                    checked={priority === source}
                    onChange={() => {
                      setPriority(source);
                    }}
                  />
                  {sourceName(source)}
                </label>
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500 dark:text-zinc-400">
              {t(
                'Если точного совпадения нет, проверим вторую площадку. После смены приоритета запустите подбор заново.',
              )}
            </p>
          </fieldset>
          {state.error && (
            <div
              role="alert"
              className="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300"
            >
              {state.error}
            </div>
          )}
          {state.needsVkLogin && (
            <div className="space-y-2 rounded-xl border border-slate-200 p-3 text-sm dark:border-zinc-700">
              {platformBridge.canOpenVkImportWindow ? (
                <>
                  <p>
                    {t(
                      'Войдите на сайте VK в отдельном окне. После загрузки плейлиста окно закроется, а временная сессия будет удалена.',
                    )}
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setPage(0);
                      setName(null);
                      void actions.load(url, true);
                    }}
                    className="flex items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 font-semibold dark:bg-zinc-800"
                  >
                    <ExternalLink size={16} />
                    {t('Открыть VK и загрузить плейлист')}
                  </button>
                </>
              ) : (
                <p>
                  {t(
                    'Для этого плейлиста VK нужен вход. Перенесите его в SoSo Music на ПК, затем отправьте медиатеку на телефон через синхронизацию.',
                  )}
                </p>
              )}
            </div>
          )}
          {state.phase === 'loading' && (
            <div role="status" className="flex items-center gap-2 text-sm">
              <Loader2 className="shrink-0 animate-spin" size={18} />
              <span>
                {state.waitingForVk
                  ? t(
                      'Войдите в открывшемся окне VK. После входа список треков загрузится автоматически.',
                    )
                  : t('Загрузка списка треков…')}
              </span>
              <button type="button" className="ml-auto underline" onClick={actions.stop}>
                {t('Отменить')}
              </button>
            </div>
          )}
          {state.playlist && (
            <>
              <div className="rounded-xl bg-slate-50 p-3 dark:bg-zinc-800/60">
                <p className="font-semibold">{state.playlist.title}</p>
                <p className="mt-1 text-xs text-slate-500 dark:text-zinc-400">
                  {state.playlist.source === 'vk' ? t('VK Музыка') : t('Яндекс Музыка')} · {total}{' '}
                  {t(' треков · порядок сохранится')}
                </p>
              </div>
              {total === 0 && <p className="text-sm text-slate-500">{t('Этот плейлист пуст.')}</p>}
              {['ready', 'review'].includes(state.phase) && total > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPage(0);
                    void actions.match(priority);
                  }}
                  className="w-full rounded-xl bg-soso-brand px-4 py-3 text-sm font-bold text-black"
                >
                  {state.phase === 'review' ? t('Подобрать заново') : t('Найти треки')} ·{' '}
                  {sourceName(priority)} {t(' в приоритете')}
                </button>
              )}
              {state.phase === 'matching' && (
                <div className="space-y-2" role="status">
                  <div className="flex items-center justify-between text-sm">
                    <span>
                      {t('Обработано ')}
                      {state.completed} {t(' из ')}
                      {total}
                    </span>
                    <button type="button" onClick={actions.stop} className="underline">
                      {t('Остановить')}
                    </button>
                  </div>
                  <progress
                    aria-label={t('Подбор треков')}
                    value={state.completed}
                    max={total}
                    className="h-2 w-full accent-soso-brand"
                  />
                </div>
              )}
              {['matching', 'review', 'saving', 'saved'].includes(state.phase) && (
                <>
                  <p className="text-sm text-slate-600 dark:text-zinc-300">
                    {t('Выбрано: ')}
                    {accepted} {t(' · Требуют проверки: ')}
                    {uncertain} {t(' · Не найдены или ошибка поиска: ')}
                    {missing}
                  </p>
                  <div className="space-y-2">
                    {state.playlist.tracks
                      .slice(page * 50, page * 50 + 50)
                      .map((original, offset) => {
                        const index = page * 50 + offset;
                        const match = state.matches[index];
                        return (
                          <div
                            key={`${original.id}:${index}`}
                            className="rounded-xl border border-slate-200 p-3 dark:border-zinc-700"
                          >
                            <p className="text-sm font-semibold">
                              {index + 1}. {original.title}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-zinc-400">
                              {original.artist || t('Исполнитель не указан')}
                            </p>
                            {match?.candidates.length ? (
                              <select
                                aria-label={t('Совпадение для {0}', original.title)}
                                value={match.track ? `${match.track.source}:${match.track.id}` : ''}
                                onChange={(event) => actions.select(index, event.target.value)}
                                disabled={busy || state.phase === 'saved'}
                                className="mt-2 w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 text-xs dark:border-zinc-600 dark:bg-zinc-800"
                              >
                                <option value="">
                                  {match.status === 'review'
                                    ? t('Проверьте совпадение или пропустите')
                                    : t('Пропустить трек')}
                                </option>
                                {match.candidates.map((candidate) => (
                                  <option
                                    key={`${candidate.source}:${candidate.id}`}
                                    value={`${candidate.source}:${candidate.id}`}
                                  >
                                    {sourceName(candidate.source)} · {candidate.artist.name} —{' '}
                                    {candidate.title} · {Math.floor(candidate.duration / 60)}:
                                    {String(candidate.duration % 60).padStart(2, '0')}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <p className="mt-2 text-xs text-slate-500 dark:text-zinc-400">
                                {match?.status === 'error'
                                  ? t('Ошибка поиска: {0}', match.error)
                                  : match
                                    ? t('Совпадений не найдено — будет пропущен')
                                    : t('Ещё не обработан')}
                              </p>
                            )}
                          </div>
                        );
                      })}
                  </div>
                  {pages > 1 && (
                    <div className="flex items-center justify-between text-xs">
                      <button
                        type="button"
                        disabled={page === 0}
                        onClick={() => setPage(page - 1)}
                        className="rounded-lg p-2 disabled:opacity-40"
                      >
                        {t('Назад')}
                      </button>
                      <span>
                        {page + 1} / {pages}
                      </span>
                      <button
                        type="button"
                        disabled={page + 1 >= pages}
                        onClick={() => setPage(page + 1)}
                        className="rounded-lg p-2 disabled:opacity-40"
                      >
                        {t('Дальше')}
                      </button>
                    </div>
                  )}
                </>
              )}
              {state.phase === 'review' && (
                <div className="space-y-3">
                  <label htmlFor="playlist-import-name" className="block text-sm font-semibold">
                    {t('Название нового плейлиста')}
                  </label>
                  <input
                    id="playlist-import-name"
                    maxLength={200}
                    value={name ?? state.playlist.title}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-transparent px-3 py-2 text-sm dark:border-zinc-700"
                  />
                  <p className="text-xs text-slate-500 dark:text-zinc-400">
                    {t(
                      'Сохраним только выбранные записи. Повторы одной записи будут объединены. Ненайденные песни останутся в отчёте.',
                    )}
                  </p>
                  <button
                    type="button"
                    disabled={!accepted || !(name ?? state.playlist.title).trim()}
                    onClick={() => {
                      void actions.save(name ?? state.playlist!.title);
                    }}
                    className="w-full rounded-xl bg-soso-brand px-4 py-3 text-sm font-bold text-black disabled:opacity-40"
                  >
                    {t('Сохранить выбранные треки (')}
                    {accepted})
                  </button>
                </div>
              )}
              {state.phase === 'saving' && (
                <p role="status" className="flex items-center gap-2 text-sm">
                  <Loader2 className="animate-spin" size={18} />
                  {t('Сохранение плейлиста…')}
                </p>
              )}
              {state.phase === 'saved' && (
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-xl bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300"
                >
                  <Check size={18} />
                  {t('Плейлист сохранён: ')}
                  {state.savedCount} {t(' треков.')}
                </div>
              )}
              {['review', 'saved'].includes(state.phase) && (
                <button
                  type="button"
                  onClick={downloadReport}
                  className="flex items-center gap-2 text-sm text-slate-600 underline dark:text-zinc-300"
                >
                  <ArrowDownToLine size={16} />
                  {t('Скачать отчёт о переносе')}
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
