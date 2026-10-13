import { useEffect, useRef, useState } from 'react';
import type { Album, Artist, MusicSource, Track } from '../types/index.ts';
import { platformBridge } from '../bridge/platformBridge.ts';

function normalizeSearchText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function albumFrom(value: any, artist: Artist): Album | null {
  const title = String(value?.title || '').trim();
  if (!title || /^single$/i.test(title)) return null;
  const artistName = value?.artist?.name || value?.artist_name || artist.name;
  return {
    ...value,
    id:
      value?.id ??
      `${artist.source || 'music'}_${normalizeSearchText(artistName)}_${normalizeSearchText(title)}`,
    title,
    cover:
      value?.cover ||
      value?.cover_medium ||
      value?.cover_big ||
      value?.cover_xl ||
      value?.cover_url ||
      '',
    cover_medium: value?.cover_medium || value?.cover || value?.cover_big || value?.cover_xl || '',
    artist: { id: value?.artist?.id ?? artist.id, name: artistName },
    artist_name: artistName,
    source: value?.source || artist.source,
  };
}

function mergeAlbums(albums: Album[]): Album[] {
  const seen = new Set<string>();
  return albums.filter((album) => {
    const key = `${normalizeSearchText(album.artist?.name || '')}:${normalizeSearchText(album.title)}`;
    if (!album.title || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Combine title search results with artist discographies and album data on tracks. */
export function useArtistSearchAlbums(
  query: string,
  artists: Artist[],
  tracks: Track[],
  searchByTitle = false,
  source: MusicSource = 'all',
): Album[] {
  const [albums, setAlbums] = useState<Album[]>([]);
  const requestId = useRef(0);
  const artistAlbumRequests = useRef(new Map<string, Promise<Album[]>>());

  useEffect(() => {
    const currentRequest = ++requestId.current;
    const normalizedQuery = normalizeSearchText(query);
    if (normalizedQuery.length < 3) {
      setAlbums([]);
      return;
    }

    const matchingArtists = artists
      .filter((artist) => {
        const normalizedName = normalizeSearchText(artist.name || '');
        return (
          normalizedName.includes(normalizedQuery) ||
          normalizedQuery
            .split(' ')
            .filter(Boolean)
            .every((word) => normalizedName.includes(word))
        );
      })
      .slice(0, 3);

    if (matchingArtists.length === 0 && !searchByTitle) {
      setAlbums([]);
      return;
    }

    const matchingNames = new Set(
      matchingArtists.map((artist) => normalizeSearchText(artist.name)),
    );
    const trackAlbums = tracks.flatMap((track) => {
      const trackArtist = normalizeSearchText(
        typeof track.artist === 'string' ? track.artist : track.artist?.name || '',
      );
      const artist = matchingArtists.find((candidate) => {
        const name = normalizeSearchText(candidate.name);
        return (
          matchingNames.has(name) && (trackArtist === name || trackArtist.startsWith(`${name} `))
        );
      });
      if (!artist) return [];
      const album = albumFrom(track.album, artist);
      return album ? [album] : [];
    });
    setAlbums(mergeAlbums(trackAlbums));

    const requests = matchingArtists.map((artist) => {
      const key = `${artist.source || 'unknown'}:${artist.id}`;
      let request = artistAlbumRequests.current.get(key);
      if (!request) {
        request = platformBridge
          .getArtist(artist.id, artist.name, artist.source)
          .then(
            (details) =>
              (details?.albums || [])
                .map((album: any) => albumFrom(album, artist))
                .filter(Boolean) as Album[],
          )
          .catch((error) => {
            artistAlbumRequests.current.delete(key);
            console.debug('[SearchView] Failed to load artist albums:', error);
            return [];
          });
        artistAlbumRequests.current.set(key, request);
      }
      return request;
    });

    if (searchByTitle) {
      requests.push(
        platformBridge.getAutocomplete(query).then((suggestions) =>
          suggestions
            .filter(
              (suggestion) =>
                suggestion.type === 'album' && (source === 'all' || suggestion.source === source),
            )
            .slice(0, 8)
            .map((suggestion): Album => ({
              id: suggestion.id,
              title: suggestion.title,
              artist: { name: suggestion.artist || 'Неизвестный исполнитель' },
              artist_name: suggestion.artist || 'Неизвестный исполнитель',
              cover: suggestion.picture || '',
              cover_medium: suggestion.picture || '',
              source: suggestion.source,
            })),
        ),
      );
    }

    void Promise.allSettled(requests).then((settled) => {
      if (requestId.current !== currentRequest) return;
      const detailedAlbums = settled.flatMap((result) =>
        result.status === 'fulfilled' ? result.value : [],
      );
      setAlbums(mergeAlbums([...detailedAlbums, ...trackAlbums]));
    });

    return () => {
      if (requestId.current === currentRequest) requestId.current++;
    };
  }, [query, artists, tracks, searchByTitle, source]);

  return albums;
}
