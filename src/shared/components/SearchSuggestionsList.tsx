import { ArrowRight, Disc3, ListPlus, Music, Play, Search, Users } from 'lucide-react';
import type { Album, AutocompleteSuggestion } from '../types/index.ts';
import { t } from '../i18n/locale';

export type SearchSuggestion =
  | { kind: 'album'; item: Album }
  | { kind: 'artist' | 'trackArtist' | 'next'; item: AutocompleteSuggestion }
  | { kind: 'track'; item: AutocompleteSuggestion; hasQueueAction?: boolean };

export type SearchSuggestionOption = SearchSuggestion & { id: string };

interface SearchSuggestionsListProps {
  listId: string;
  options: SearchSuggestionOption[];
  activeId?: string;
  onSelect: (option: SearchSuggestionOption) => void;
}

export function SearchSuggestionsList({
  listId,
  options,
  activeId,
  onSelect,
}: SearchSuggestionsListProps) {
  return (
    <ul
      id={listId}
      role="listbox"
      aria-label={t('Подсказки')}
      className="grid grid-cols-[minmax(0,1fr)_auto]"
    >
      {options.map((option) => {
        const { id, kind, item } = option;
        const active = id === activeId;
        if (kind === 'next') {
          return (
            <li
              key={id}
              id={id}
              role="option"
              aria-selected={active}
              aria-label={t('Играть следующим — {0}', item.title)}
              title={t('Играть следующим')}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onSelect(option)}
              className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-xl px-2 text-xs font-semibold hover:bg-slate-100 dark:hover:bg-zinc-800/80 ${active ? 'bg-slate-100 text-soso-brand dark:bg-zinc-800/80' : 'text-slate-600 dark:text-zinc-300'}`}
            >
              <ListPlus aria-hidden="true" className="h-4 w-4 shrink-0" />
              <span className="hidden sm:inline">{t('Играть следующим')}</span>
            </li>
          );
        }
        const playable = kind === 'track' && Boolean(item.track);
        const queryCompletion = kind === 'track' && !playable && item.artist === 'Поиск';
        const ActionIcon = playable ? Play : ArrowRight;
        const Icon =
          kind === 'album' ? Disc3 : queryCompletion ? Search : kind === 'track' ? Music : Users;
        const title = kind === 'trackArtist' ? item.artist : item.title;
        const artwork =
          kind === 'album'
            ? item.cover_xl || item.cover_big || item.cover_medium || item.cover
            : kind === 'trackArtist'
              ? undefined
              : item.picture;
        const detail =
          kind === 'album'
            ? item.artist?.name || item.artist_name
            : kind === 'track' && item.artist !== 'SoundCloud' && item.artist !== 'Поиск'
              ? item.artist
              : undefined;
        return (
          <li
            key={id}
            id={id}
            role="option"
            aria-selected={active}
            aria-label={
              kind === 'trackArtist'
                ? t('Поиск исполнителя: {0}', title)
                : playable
                  ? [t('Воспроизвести'), title, detail].filter(Boolean).join(' · ')
                  : queryCompletion
                    ? [t('Поиск'), title].join(' · ')
                    : undefined
            }
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onSelect(option)}
            className={`group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-800 dark:text-zinc-200 hover:bg-slate-100 dark:hover:bg-zinc-800/80 ${active ? 'bg-slate-100 dark:bg-zinc-800/80' : ''} ${kind === 'trackArtist' ? 'pl-8' : ''} ${kind === 'track' && option.hasQueueAction ? '' : 'col-span-2'}`}
          >
            {artwork ? (
              <img
                src={artwork}
                alt=""
                className={`shrink-0 object-cover ${kind === 'album' ? 'h-7 w-7 rounded-md' : kind === 'artist' ? 'h-5 w-5 rounded-full' : 'h-5 w-5 rounded-md'}`}
                onError={(event) => {
                  event.currentTarget.style.display = 'none';
                }}
              />
            ) : (
              <Icon aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-400" />
            )}
            <span className="min-w-0 flex-1 truncate">
              <span className="font-semibold text-slate-900 dark:text-white">{title}</span>
              {kind === 'artist' && (
                <span
                  className={`ml-2 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium ${item.source === 'soundcloud' ? 'border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'border-red-500/30 bg-red-500/15 text-red-600 dark:text-red-400'}`}
                >
                  {item.source === 'soundcloud' ? 'SoundCloud' : 'YouTube Music'}
                </span>
              )}
              {detail && (
                <span className="ml-2 text-xs text-slate-500 dark:text-zinc-400">{detail}</span>
              )}
            </span>
            <ActionIcon
              aria-hidden="true"
              className={`h-3.5 w-3.5 shrink-0 text-slate-400 transition-opacity ${active ? '' : 'opacity-0 group-hover:opacity-100'}`}
            />
          </li>
        );
      })}
    </ul>
  );
}
