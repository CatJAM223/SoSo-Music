import React from 'react';
import { ArrowRight, Disc3, Music, Users } from 'lucide-react';
import type { Album, AutocompleteSuggestion } from '../types/index.ts';

interface SearchSuggestionsListProps {
  artists: AutocompleteSuggestion[];
  tracks: AutocompleteSuggestion[];
  albums: Album[];
  onSelectSuggestion: (suggestion: AutocompleteSuggestion, onlyArtist?: boolean) => void;
  onSelectAlbum: (album: Album) => void;
}

const separator = 'mx-3 my-1 border-t border-slate-200 dark:border-zinc-700/70';

export const SearchSuggestionsList: React.FC<SearchSuggestionsListProps> = ({
  artists,
  tracks,
  albums,
  onSelectSuggestion,
  onSelectAlbum,
}) => (
  <>
    {artists.map((item) => (
      <div
        key={`artist:${item.source || 'unknown'}:${item.id}`}
        onClick={() => onSelectSuggestion(item)}
        className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 cursor-pointer text-sm text-slate-800 dark:text-zinc-200 hover:text-slate-950 dark:hover:text-white transition-colors group"
      >
        {item.picture ? (
          <img
            src={item.picture}
            alt={item.title}
            className="w-5 h-5 rounded-full object-cover shrink-0 ring-1 ring-black/20 dark:ring-white/15"
            onError={(event) => {
              event.currentTarget.style.display = 'none';
            }}
          />
        ) : (
          <Users className="w-4 h-4 text-slate-400 dark:text-zinc-500 group-hover:text-soso-brand shrink-0" />
        )}
        <div className="flex-1 truncate">
          <span className="font-semibold text-slate-900 dark:text-white">{item.title}</span>
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ml-2 inline-flex items-center ${
              item.source === 'soundcloud'
                ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30'
                : 'bg-red-500/15 text-red-600 dark:text-red-400 border border-red-500/30'
            }`}
          >
            {item.source === 'soundcloud' ? 'SoundCloud' : 'YouTube Music'}
          </span>
        </div>
        <ArrowRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    ))}

    {artists.length > 0 && albums.length > 0 && <div aria-hidden="true" className={separator} />}

    {albums.map((album) => {
      const cover = album.cover_xl || album.cover_big || album.cover_medium || album.cover;
      return (
        <button
          type="button"
          key={`album:${album.source || 'unknown'}:${album.id}`}
          onClick={() => onSelectAlbum(album)}
          className="flex w-full items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-slate-100 dark:hover:bg-zinc-800/80 text-sm text-slate-800 dark:text-zinc-200 transition-colors group"
        >
          {cover ? (
            <img
              src={cover}
              alt=""
              className="w-7 h-7 rounded-md object-cover shrink-0"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Disc3 className="w-5 h-5 text-slate-400 dark:text-zinc-500 shrink-0" />
          )}
          <span className="flex-1 min-w-0 truncate">
            <span className="font-semibold text-slate-900 dark:text-white">{album.title}</span>
            <span className="text-slate-500 dark:text-zinc-400 text-xs ml-2">
              {album.artist?.name || album.artist_name}
            </span>
          </span>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
      );
    })}

    {(artists.length > 0 || albums.length > 0) && tracks.length > 0 && (
      <div aria-hidden="true" className={separator} />
    )}

    {tracks.map((item) => {
      const hasValidArtist = item.artist && item.artist !== 'SoundCloud' && item.artist !== 'Поиск';
      return (
        <div
          key={`track:${item.source || 'unknown'}:${item.id}`}
          onClick={() => onSelectSuggestion(item)}
          className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-zinc-800/80 cursor-pointer text-sm text-slate-800 dark:text-zinc-200 hover:text-slate-950 dark:hover:text-white transition-colors group"
        >
          {item.picture ? (
            <img
              src={item.picture}
              alt={item.title}
              className="w-5 h-5 rounded-md object-cover shrink-0 ring-1 ring-black/20 dark:ring-white/15"
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
          ) : (
            <Music className="w-4 h-4 text-slate-400 dark:text-zinc-500 group-hover:text-soso-brand shrink-0" />
          )}
          <div className="flex-1 truncate">
            <span className="font-semibold text-slate-900 dark:text-white">{item.title}</span>
            {hasValidArtist && (
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  onSelectSuggestion(item, true);
                }}
                className="text-slate-500 dark:text-zinc-400 text-xs ml-2"
              >
                — {item.artist}
              </span>
            )}
          </div>
          <ArrowRight className="w-3.5 h-3.5 text-slate-400 opacity-0 group-hover:opacity-100 transition-opacity" />
        </div>
      );
    })}
  </>
);
