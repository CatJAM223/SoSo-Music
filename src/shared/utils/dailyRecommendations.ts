import type { Track } from '../types/index.ts';
import { areSameWaveSong, buildWaveSongIdentity, getWaveArtistKeys } from './waveIdentity.ts';

export const DAILY_RECOMMENDATIONS_KEY = 'soso:daily-recommendations:v1';
export interface DailyRecommendations {
  day: string;
  tracks: Track[];
}

export function localRecommendationDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Keep provider ranking, while avoiding five songs by the same musician. */
export function selectDailyRecommendations(candidates: Track[], seeds: Track[]): Track[] {
  const knownArtists = seeds.flatMap((track) =>
    typeof track.artist === 'string' ? [track.artist] : [track.artist?.name || ''],
  );
  const knownSongs = seeds.map((track) => buildWaveSongIdentity(track, knownArtists));
  const selected: Track[] = [];
  const counts = new Map<string, number>();
  for (const artistLimit of [1, 2]) {
    for (const track of candidates) {
      if (selected.length >= 5) break;
      if (
        !track?.id ||
        track.playbackUnavailable ||
        selected.some((item) => String(item.id) === String(track.id))
      )
        continue;
      const song = buildWaveSongIdentity(track, knownArtists);
      if (
        knownSongs.some((known) => areSameWaveSong(known, song)) ||
        selected.some((item) => areSameWaveSong(buildWaveSongIdentity(item, knownArtists), song))
      )
        continue;
      const artists = getWaveArtistKeys(track, knownArtists);
      if (!artists.length || artists.some((artist) => (counts.get(artist) || 0) >= artistLimit))
        continue;
      selected.push(track);
      artists.forEach((artist) => counts.set(artist, (counts.get(artist) || 0) + 1));
    }
  }
  return selected;
}

export function readDailyRecommendations(raw: string | null): DailyRecommendations | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (
      !value ||
      typeof value.day !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value.day) ||
      !Array.isArray(value.tracks)
    )
      return null;
    const tracks = value.tracks
      .slice(0, 5)
      .filter(
        (track: Track) =>
          track &&
          (typeof track.id === 'string' || typeof track.id === 'number') &&
          typeof track.title === 'string' &&
          track.artist &&
          typeof track.artist.name === 'string',
      );
    return tracks.length ? { day: value.day, tracks } : null;
  } catch {
    return null;
  }
}

/** A local-day snapshot; generating one does not update listening history. */
export function createDailyRecommendationLoader(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  fetchTracks: (previousIds: (string | number)[]) => Promise<Track[]>,
  now: () => Date = () => new Date(),
) {
  const pending = new Map<string, Promise<DailyRecommendations>>();
  let memory: DailyRecommendations | null = null;
  return () => {
    const day = localRecommendationDay(now());
    if (memory?.day === day) return Promise.resolve(memory);
    let saved = memory;
    try {
      saved = readDailyRecommendations(storage.getItem(DAILY_RECOMMENDATIONS_KEY)) || saved;
    } catch {
      /* Memory works when storage is unavailable. */
    }
    if (saved?.day === day) {
      memory = saved;
      return Promise.resolve(saved);
    }
    const existing = pending.get(day);
    if (existing) return existing;
    const request = Promise.resolve()
      .then(() => fetchTracks(saved?.tracks.map((track) => track.id) || []))
      .then((tracks) => {
        const clean = tracks.slice(0, 5).map((track) => {
          const { resolvedStreamUrl, resolvedStreamTimestamp, ...metadata } = track;
          return metadata;
        });
        const result = { day, tracks: clean };
        if (localRecommendationDay(now()) === day && clean.length) {
          memory = result;
          try {
            storage.setItem(DAILY_RECOMMENDATIONS_KEY, JSON.stringify(result));
          } catch {
            /* Keep this session stable. */
          }
        }
        return result;
      })
      .finally(() => pending.delete(day));
    pending.set(day, request);
    return request;
  };
}
