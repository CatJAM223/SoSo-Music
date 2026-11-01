import { requireRustCompute } from '../compute/rustCore.ts';
import { dailyDecision } from '../compute/dailySelection.ts';
import type { Track } from '../types/index.ts';
import { tasteTrackId } from './tastePolicy.ts';
import {
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
  const rejected = disliked.map((track) => ({
    id: tasteTrackId(track.id),
    song: identityOf(track),
  }));
  const packet = (track: { id?: unknown; title?: string; artist?: Track['artist'] | string }) => ({
    id: tasteTrackId(track.id),
    song: identityOf(track),
  });
  const rejectionCount = (track: Pick<Track, 'title' | 'artist'>) =>
    dailyDecision('daily_rejections', [packet(track)], [], rejected)[0] || 0;
  return {
    artistFeedback: Object.fromEntries(
      [...knownArtistKeys].map((artist) => [
        artist,
        requireRustCompute().daily_artist_feedback(
          rejectionCount({ title: '', artist: { name: artist } }),
        ),
      ]),
    ),
    rejectionCount,
    needsMore(count: number, attempt: number, added: number) {
      return !!requireRustCompute().daily_refill(count, attempt, added);
    },
    acceptsArtist(_name: string): boolean {
      return true;
    },
    accepts(track: Track): boolean {
      return dailyDecision('daily_accepts', [packet(track)], [], rejected).length > 0;
    },
    select(candidates: Track[], known: Track[], preserve = 0): Track[] {
      const names = [...knownArtists, ...known.flatMap(getWaveArtistNames)];
      const encode = (track: Track) => ({
        id: tasteTrackId(track.id),
        song: buildWaveSongIdentity(track, names),
        unavailable: track.playbackUnavailable,
      });
      return dailyDecision(
        'daily_select',
        candidates.map(encode),
        known.map(encode),
        rejected,
        preserve,
      ).map((index) => candidates[index]);
    },
  };
}

/** Collapse existing ID aliases and include a policy version to invalidate older daily caches. */
export function dailyDislikeKey(ids: Iterable<string>): string {
  return 'v3:' + JSON.stringify([...new Set([...ids].map(tasteTrackId).filter(Boolean))].sort());
}
