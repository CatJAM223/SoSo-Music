import { t } from '../../../shared/i18n/locale';
type Props = {
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRetry: () => void;
};
export function LibraryPageControls({
  loading,
  refreshing,
  error,
  hasMore,
  onLoadMore,
  onRetry,
}: Props) {
  if (!hasMore && !error && !refreshing) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 py-3" aria-busy={loading || refreshing}>
      {refreshing && (
        <span className="text-xs text-slate-500" aria-live="polite">
          {t('Обновляем…')}
        </span>
      )}
      {error && (
        <span role="alert">
          {error}{' '}
          <button type="button" onClick={onRetry}>
            {t('Повторить')}
          </button>
        </span>
      )}
      {hasMore && (
        <button
          type="button"
          onClick={onLoadMore}
          disabled={loading || refreshing}
          className="rounded-lg px-3 py-2 bg-slate-100 dark:bg-zinc-800"
        >
          {loading ? t('Загрузка…') : t('Загрузить ещё')}
        </button>
      )}
    </div>
  );
}
