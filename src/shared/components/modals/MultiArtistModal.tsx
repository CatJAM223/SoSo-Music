import { useEffect, useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { platformBridge } from '../../bridge/platformBridge';
import { useNativeModal } from '../../hooks/useNativeModal';
import { t } from '../../i18n/locale';
import { useLocale } from '../../i18n/useLocale';
import type { Artist, MusicSource } from '../../types';
import type { ArtistDestination } from '../../types/artistNavigation';
import { generateInitialsAvatarUri } from '../../utils/placeholder';
import './MultiArtistModal.css';

type Props = {
  artists: ArtistDestination[];
  onClose: () => void;
  onSelectArtist: (artist: ArtistDestination) => void;
};

function artistNameKey(name: string) {
  return name.normalize('NFKC').trim().toLowerCase();
}

async function findArtist(artist: ArtistDestination, source: MusicSource) {
  const result = await platformBridge.searchArtists(artist.name, 6, source).catch(() => null);
  const data: Artist[] = result?.data ?? [];
  return (
    data.find((candidate) => artist.id != null && String(candidate.id) === String(artist.id)) ||
    data.find((candidate) => artistNameKey(candidate.name) === artistNameKey(artist.name))
  );
}

export function MultiArtistModal({ artists, onClose, onSelectArtist }: Props) {
  useLocale();
  const dialog = useNativeModal();
  const headingId = useId();
  const [profiles, setProfiles] = useState(new Map<string, ArtistDestination>());

  useEffect(() => {
    let active = true;

    const resolveArtist = async (artist: ArtistDestination) => {
      if (artist.id && artist.picture) return;
      let source: MusicSource =
        artist.source === 'soundcloud' || artist.source === 'youtube' ? artist.source : 'all';
      let match = await findArtist(artist, source);
      if (active && !match && artist.id == null && source !== 'all') {
        source = source === 'youtube' ? 'soundcloud' : 'youtube';
        match = await findArtist(artist, source);
      }
      if (!active || !match) return;

      const profile = {
        ...artist,
        id: artist.id ?? match.id,
        source: match.source || (source === 'all' ? artist.source : source),
        picture: match.picture_medium || match.picture_big || match.picture || artist.picture,
      };
      setProfiles((current) => new Map(current).set(artist.name, profile));
    };

    for (const artist of artists) {
      void resolveArtist(artist);
    }

    return () => {
      active = false;
    };
  }, [artists]);

  return createPortal(
    <dialog
      ref={dialog}
      closedby="any"
      aria-labelledby={headingId}
      className="multi-artist-dialog fixed inset-0 m-auto rounded-3xl border border-slate-200 bg-white p-4 text-slate-900 shadow-2xl select-none dark:border-zinc-800 dark:bg-[#18181b] dark:text-white"
      onKeyDown={(event) => event.stopPropagation()}
      onClose={(event) => {
        // The ref cleanup in Strict Mode can queue a close before the dialog reopens.
        if (event.currentTarget.open) return;
        const name = event.currentTarget.returnValue;
        event.currentTarget.returnValue = '';
        const artist = profiles.get(name) || artists.find((entry) => entry.name === name);
        onClose();
        if (artist) onSelectArtist(artist);
      }}
    >
      <form method="dialog" className="flex min-h-0 flex-col gap-3">
        <h2 id={headingId} className="px-2 py-1 pr-12 text-lg font-bold">
          {t('Исполнители трека')}
        </h2>
        <ul className="grid max-h-[60vh] gap-1.5 overflow-y-auto overscroll-contain p-1">
          {artists.map((credit) => {
            const artist = profiles.get(credit.name) || credit;
            const fallback = generateInitialsAvatarUri(artist.name);
            return (
              <li key={artist.name}>
                <button
                  type="submit"
                  value={artist.name}
                  className="flex w-full items-center gap-3 rounded-2xl bg-slate-50 p-2.5 text-left hover:bg-slate-100 focus-visible:outline-2 focus-visible:-outline-offset-2 dark:bg-zinc-800/60 dark:hover:bg-zinc-800"
                >
                  <img
                    src={artist.picture || fallback}
                    alt=""
                    className="size-11 shrink-0 rounded-full bg-zinc-800 object-cover"
                    onError={(event) => {
                      if (event.currentTarget.src !== fallback) event.currentTarget.src = fallback;
                    }}
                  />
                  <span className="min-w-0 flex-1 wrap-anywhere text-sm font-semibold">
                    {artist.name}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="submit"
          value=""
          aria-label={t('Закрыть')}
          className="absolute top-3 right-3 rounded-xl p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-white"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </form>
    </dialog>,
    document.body,
  );
}
