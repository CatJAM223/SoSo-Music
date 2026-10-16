import type { Artist, Album, MusicSource, Playlist, Track } from '../../shared/types';
import type { MyMusicTab } from '../../shared/hooks/useMyMusicViewModel';

export interface SearchPageState {
  query: string;
  draft: string;
  source: MusicSource;
  results: Track[];
  artists: Artist[];
  completed: boolean;
}
export interface MyMusicPageState {
  tab: MyMusicTab;
  query: string;
  sort?: import('../../shared/types/libraryPage').LibrarySort;
  loadedCounts?: Partial<Record<import('../../shared/types/libraryPage').LibraryKind, number>>;
}
export interface PageState {
  search?: SearchPageState;
  music?: MyMusicPageState;
  playlistQuery?: string;
  scrollTop?: number;
}
export interface HistoryEntry {
  id: number;
  view: string;
  playlist?: Playlist | null;
  artist?: { id?: string | number; name: string; source?: string } | null;
  album?: Album | any;
  searchQuery?: string;
  initialTab?: MyMusicTab;
  page?: PageState;
}
export interface NavigationHistory {
  entries: HistoryEntry[];
  index: number;
  nextId: number;
}
export const initialNavigationHistory: NavigationHistory = {
  entries: [{ id: 0, view: 'discover' }],
  index: 0,
  nextId: 1,
};
type Action =
  | { type: 'navigate'; entry: Omit<HistoryEntry, 'id'> }
  | { type: 'back' | 'forward' }
  | { type: 'snapshot'; id: number; page: Partial<PageState> };

/** Keep each visit's state distinct, even when the same view appears more than once. */
export function navigationHistoryReducer(
  state: NavigationHistory,
  action: Action,
): NavigationHistory {
  if (action.type === 'back') return { ...state, index: Math.max(0, state.index - 1) };
  if (action.type === 'forward')
    return { ...state, index: Math.min(state.entries.length - 1, state.index + 1) };
  if (action.type === 'snapshot') {
    if (!state.entries.some((entry) => entry.id === action.id)) return state;
    return {
      ...state,
      entries: state.entries.map((entry) =>
        entry.id === action.id ? { ...entry, page: { ...entry.page, ...action.page } } : entry,
      ),
    };
  }
  if (action.type === 'navigate') {
    const entries = [
      ...state.entries.slice(0, state.index + 1),
      { ...action.entry, id: state.nextId },
    ].slice(-50);
    return { entries, index: entries.length - 1, nextId: state.nextId + 1 };
  }
  return state;
}
