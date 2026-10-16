import { useEffect, useMemo, useState } from 'react';
import type {
  LibraryKind,
  LibraryPage,
  LibraryPageRequest,
  LibrarySort,
} from '../types/libraryPage';
import { LibraryPageController, libraryQueryKey } from '../utils/libraryPageController';
type Options<K extends LibraryKind> = {
  kind: K;
  query: string;
  sort: LibrarySort;
  enabled: boolean;
  initialCount?: number;
  read: (request: LibraryPageRequest<K>) => Promise<LibraryPage<K>>;
};
export function usePagedLibrary<K extends LibraryKind>({
  kind,
  query,
  sort,
  enabled,
  initialCount,
  read,
}: Options<K>) {
  const controller = useMemo(() => new LibraryPageController(kind, read), [kind, read]);
  const [state, setState] = useState(controller.getSnapshot);
  useEffect(() => {
    setState(controller.getSnapshot());
    return controller.subscribe(() => setState(controller.getSnapshot()));
  }, [controller]);
  useEffect(() => {
    controller.configure(query, sort, enabled, initialCount);
    return controller.deactivate;
  }, [controller, query, sort, enabled, initialCount]);
  const key = libraryQueryKey(kind, query, sort);
  // No single frame of records from another query before the effect runs.
  const visible =
    state.key === key
      ? state
      : {
          key,
          items: [],
          total: 0,
          nextOffset: null,
          loading: enabled,
          refreshing: false,
          loadingMore: false,
          error: null,
        };
  return {
    ...visible,
    loadMore: controller.loadMore,
    refresh: controller.invalidate,
    retry: controller.refresh,
  };
}
