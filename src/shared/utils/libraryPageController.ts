import type {
  LibraryItems,
  LibraryKind,
  LibraryPage,
  LibraryPageRequest,
  LibrarySort,
} from '../types/libraryPage';
export interface LibraryPageState<K extends LibraryKind> {
  key: string;
  items: LibraryItems[K][];
  total: number;
  nextOffset: number | null;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string | null;
}
export interface PageClock {
  set(callback: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}
const clock: PageClock = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};
export function libraryQueryKey(kind: LibraryKind, query: string, sort: LibrarySort) {
  return JSON.stringify([kind, query.trim().toLowerCase(), sort]);
}
export class LibraryPageController<K extends LibraryKind> {
  private generation = 0;
  private enabled = false;
  private timer: unknown = null;
  private query = '';
  private sort: LibrarySort = 'recent';
  private target = 100;
  private listeners = new Set<() => void>();
  private state: LibraryPageState<K> = {
    key: '',
    items: [],
    total: 0,
    nextOffset: null,
    loading: false,
    refreshing: false,
    loadingMore: false,
    error: null,
  };
  private kind: K;
  private read: (r: LibraryPageRequest<K>) => Promise<LibraryPage<K>>;
  private schedule: PageClock;
  constructor(
    kind: K,
    read: (r: LibraryPageRequest<K>) => Promise<LibraryPage<K>>,
    schedule: PageClock = clock,
  ) {
    this.kind = kind;
    this.read = read;
    this.schedule = schedule;
  }
  private validatePage(page: LibraryPage<K>, offset: number) {
    if (
      page.kind !== this.kind ||
      page.offset !== offset ||
      !Number.isSafeInteger(page.total) ||
      page.total < 0 ||
      !Array.isArray(page.items) ||
      page.items.length > 100
    )
      throw new Error('Invalid library page cursor');
    const end = offset + page.items.length;
    if (
      (page.items.length > 0 && end > page.total) ||
      (page.items.length === 0 && offset < page.total) ||
      page.nextOffset !== (end < page.total ? end : null)
    )
      throw new Error('Invalid library page cursor');
  }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(patch: Partial<LibraryPageState<K>>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  private cancelTimer() {
    if (this.timer !== null) {
      this.schedule.clear(this.timer);
      this.timer = null;
    }
  }
  configure(query: string, sort: LibrarySort, enabled: boolean, initialCount = 100) {
    const key = libraryQueryKey(this.kind, query, sort);
    const changed = key !== this.state.key;
    this.query = query.trim().toLowerCase();
    this.sort = sort;
    this.enabled = enabled;
    if (changed) {
      this.generation++;
      this.cancelTimer();
      this.target = Math.max(100, Math.min(1_000_000, Math.floor(initialCount) || 100));
      this.publish({
        key,
        items: [],
        total: 0,
        nextOffset: null,
        loading: false,
        refreshing: false,
        loadingMore: false,
        error: null,
      });
    }
    if (enabled) void this.refresh();
    else this.deactivate();
  }
  deactivate = () => {
    this.enabled = false;
    this.generation++;
    this.cancelTimer();
    this.publish({ loading: false, refreshing: false, loadingMore: false });
  };
  invalidate = () => {
    this.generation++;
    this.cancelTimer();
    this.publish({ loadingMore: false, refreshing: this.enabled && this.state.items.length > 0 });
    if (!this.enabled) return;
    this.timer = this.schedule.set(() => {
      this.timer = null;
      void this.refresh();
    }, 40);
  };
  refresh = async () => {
    if (!this.enabled) return;
    this.cancelTimer();
    const generation = ++this.generation;
    const target = Math.max(this.target, this.state.items.length, 100);
    const previous = this.state.items;
    this.publish({
      loading: previous.length === 0,
      refreshing: previous.length > 0,
      loadingMore: false,
      error: null,
    });
    try {
      let items: LibraryItems[K][] = [];
      let total = 0;
      let next: number | null = 0;
      do {
        const page = await this.read({
          kind: this.kind,
          query: this.query,
          sort: this.sort,
          offset: next ?? 0,
          limit: 100,
        });
        if (generation !== this.generation || !this.enabled) return;
        this.validatePage(page, items.length);
        if (items.length > 0 && page.total !== total)
          throw new Error('Library changed while loading; retry.');
        items = items.concat(page.items);
        total = page.total;
        next = page.nextOffset;
        // Incremental publication only on an empty initial/restore read. Refresh retains last successful prefix until complete.
        if (previous.length === 0)
          this.publish({
            items,
            total,
            nextOffset: next,
            loading: false,
            refreshing: next !== null && items.length < target,
          });
      } while (next !== null && items.length < target);
      this.target = items.length;
      this.publish({
        items,
        total,
        nextOffset: next,
        loading: false,
        refreshing: false,
        error: null,
      });
    } catch (error) {
      if (generation === this.generation && this.enabled)
        this.publish({
          loading: false,
          refreshing: false,
          error: String(error instanceof Error ? error.message : error),
        });
    }
  };
  loadMore = async () => {
    if (
      !this.enabled ||
      this.timer !== null ||
      this.state.loading ||
      this.state.refreshing ||
      this.state.loadingMore ||
      this.state.nextOffset === null
    )
      return;
    const generation = this.generation,
      offset = this.state.nextOffset;
    this.publish({ loadingMore: true, error: null });
    try {
      const page = await this.read({
        kind: this.kind,
        query: this.query,
        sort: this.sort,
        offset,
        limit: 100,
      });
      if (generation !== this.generation || !this.enabled) return;
      this.validatePage(page, offset);
      if (page.total !== this.state.total) {
        this.invalidate();
        return;
      }
      this.target = this.state.items.length + page.items.length;
      this.publish({
        items: this.state.items.concat(page.items),
        total: page.total,
        nextOffset: page.nextOffset,
        loadingMore: false,
      });
    } catch (error) {
      if (generation === this.generation && this.enabled)
        this.publish({
          loadingMore: false,
          error: String(error instanceof Error ? error.message : error),
        });
    }
  };
}
