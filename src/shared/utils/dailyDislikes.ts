import type { Track } from '../types/index.ts';
import { tasteTrackId } from './tastePolicy.ts';
import {
  areSameWaveSong,
  buildWaveSongIdentity,
  getWaveArtistNames,
  normalizeWaveArtist,
  type WaveSongIdentity,
} from './waveIdentity.ts';

export interface DailyDislikedTrack {
  id: string | number;
  title: string;
  artist: string;
}

/** Persisted track dislikes are the source of truth; undo needs no separate artist ban. */
export function createDailyDislikePolicy(disliked: readonly DailyDislikedTrack[]) {
  const knownArtists = disliked.flatMap((track) => getWaveArtistNames(track.artist));
  const knownArtistKeys = new Set(knownArtists.map(normalizeWaveArtist));
  // Negative feedback needs exact credits: a musician's name can be part of
  // another musician's longer name. Infer uploader credits only across a separator.
  const artistKeys = (track: { title?: string; artist?: Track['artist'] | string }) => {
    const keys = new Set(getWaveArtistNames(track).map(normalizeWaveArtist));
    if (!/\bcover\b|кавер/i.test(track.title || '')) {
      const parts = (track.title || '').split(/\s+[-–—|]\s+/);
      if (parts.length > 1) {
        for (const part of parts) {
          for (const name of getWaveArtistNames(part)) {
            const key = normalizeWaveArtist(name);
            if (knownArtistKeys.has(key)) keys.add(key);
          }
        }
      }
    }
    return [...keys];
  };
  const identityOf = (track: {
    title?: string;
    artist?: Track['artist'] | string;
  }): WaveSongIdentity => ({
    ...buildWaveSongIdentity(track, knownArtists),
    artists: artistKeys(track),
  });
  const songs: WaveSongIdentity[] = [];
  const songsByArtist = new Map<string, WaveSongIdentity[]>();
  const ids = new Set<string>();
  for (const track of disliked) {
    const id = tasteTrackId(track.id);
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const song = identityOf(track);
    songs.push(song);
    for (const artist of song.artists) {
      const previous = songsByArtist.get(artist) || [];
      // Re-uploads, aliases and edits of one song cannot manufacture two rejections.
      if (previous.length < 2 && !previous.some((item) => areSameWaveSong(item, song)))
        previous.push(song);
      songsByArtist.set(artist, previous);
    }
  }
  const rejectionCount = (track: Pick<Track, 'title' | 'artist'>) =>
    Math.max(0, ...artistKeys(track).map((key) => songsByArtist.get(key)?.length || 0));
  return {
    artistFeedback: Object.fromEntries(
      [...songsByArtist].map(([artist, rejected]) => [
        artist,
        -Math.min(2, rejected.length * 0.75),
      ]),
    ),
    rejectionCount,
    acceptsArtist(name: string): boolean {
      return getWaveArtistNames(name).every(
        (artist) => (songsByArtist.get(normalizeWaveArtist(artist))?.length || 0) < 2,
      );
    },
    accepts(track: Track): boolean {
      if (ids.has(tasteTrackId(track.id)) || rejectionCount(track) >= 2) return false;
      const song = identityOf(track);
      return !songs.some((rejected) => areSameWaveSong(rejected, song));
    },
  };
}

/** Collapse existing ID aliases and include a policy version to invalidate older daily caches. */
export function dailyDislikeKey(ids: Iterable<string>): string {
  return 'v2:' + JSON.stringify([...new Set([...ids].map(tasteTrackId).filter(Boolean))].sort());
}
