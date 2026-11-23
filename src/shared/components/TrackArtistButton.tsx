import { ChevronDown } from 'lucide-react';
import type { Track } from '../types';
import type { ArtistDestination, NavigateToArtist } from '../types/artistNavigation';
import { extractAllArtists } from '../utils/artistParser';
import { detectTrackSource } from '../utils/formatters';

type Props = {
  track: Track;
  onNavigateToArtist?: NavigateToArtist;
  className?: string;
};

export function TrackArtistButton({ track, onNavigateToArtist, className = '' }: Props) {
  const name = typeof track.artist === 'string' ? track.artist : track.artist?.name;
  const names = extractAllArtists(name || '', track.title);
  const multiple = names.length > 1;
  const label = names.join(', ');

  if (!onNavigateToArtist || label === 'Unknown Artist') {
    return <span className={`block min-w-0 truncate ${className}`}>{label}</span>;
  }

  const handleNavigate = () => {
    const source = track.artist?.source || detectTrackSource(track);
    const id = track.artist?.id;
    const primary: ArtistDestination = {
      name: name || names[0],
      // SoundCloud track metadata can identify the uploader instead of the credited artist.
      id: /^sc_art_\d+$/.test(String(id)) ? undefined : id,
      source,
      picture:
        source === 'soundcloud' ? track.artist?.picture_medium || track.artist?.picture : undefined,
    };

    const choices = multiple
      ? names.map((artistName) =>
          artistName.toLowerCase() === primary.name.trim().toLowerCase()
            ? { ...primary, name: artistName }
            : { name: artistName, source },
        )
      : undefined;
    onNavigateToArtist(primary, choices);
  };

  return (
    <button
      type="button"
      aria-haspopup={multiple ? 'dialog' : undefined}
      title={label}
      className={`inline-flex min-w-0 max-w-full items-center gap-1 text-left hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 ${className}`}
      onClick={(event) => {
        event.stopPropagation();
        handleNavigate();
      }}
    >
      <span className="truncate">{label}</span>
      {multiple && <ChevronDown aria-hidden="true" className="size-3 shrink-0" />}
    </button>
  );
}
