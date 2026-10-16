import type { Track } from '../types/index.ts';
import { createDailyDislikePolicy, type DailyDislikedTrack } from './dailyDislikes.ts';
import { areSameWaveSong, buildWaveSongIdentity, getWaveArtistKeys } from './waveIdentity.ts';

export const DAILY_RECOMMENDATIONS_KEY = 'soso:daily-recommendations:v1';
export interface DailyRecommendations {
  tasteRevision?: number;
  dislikeKey?: string;
  day: string;
  tracks: Track[];
}

export function localRecommendationDay(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** Keep provider ranking, while avoiding five songs by the same musician. */
export function selectDailyRecommendations(
  candidates: Track[],
  seeds: Track[],
  disliked: readonly DailyDislikedTrack[] = [],
): Track[] {
  const policy = createDailyDislikePolicy(disliked);
  const ranked = candidates
    .filter((track) => track?.id && policy.accepts(track))
    .sort((a, b) => policy.rejectionCount(a) - policy.rejectionCount(b));
  const knownArtists = seeds.flatMap((track) =>
    typeof track.artist === 'string' ? [track.artist] : [track.artist?.name || ''],
  );
  const knownSongs = seeds.map((track) => buildWaveSongIdentity(track, knownArtists));
  const selected: Track[] = [];
  const counts = new Map<string, number>();
  for (const artistLimit of [1, 2]) {
    for (const track of ranked) {
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
    return tracks.length
      ? {
          day: value.day,
          dislikeKey: typeof value.dislikeKey === 'string' ? value.dislikeKey : '',
          tasteRevision: Number.isSafeInteger(value.tasteRevision)
            ? value.tasteRevision
            : undefined,
          tracks,
        }
      : null;
  } catch {
    return null;
  }
}

/** A local-day snapshot; generating one does not update listening history. */
export function createDailyRecommendationLoader(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  fetchTracks: (previousIds: (string | number)[]) => Promise<Track[]>,
  now: () => Date = () => new Date(),
  tasteRevision: () => number = () => 0,
) {
  const pending = new Map<string, Promise<DailyRecommendations>>();
  let memory: DailyRecommendations | null = null;
  let latestKey = '';
  return (dislikeKey = '') => {
    const day = localRecommendationDay(now()),
      revision = tasteRevision(),
      key = JSON.stringify([day, revision, dislikeKey]);
    latestKey = key;
    if (
      memory?.day === day &&
      memory.tasteRevision === revision &&
      memory.dislikeKey === dislikeKey
    )
      return Promise.resolve(memory);
    let saved = memory;
    try {
      saved = readDailyRecommendations(storage.getItem(DAILY_RECOMMENDATIONS_KEY)) || saved;
    } catch {
      /* Memory works when storage is unavailable. */
    }
    if (saved?.day === day && saved.tasteRevision === revision && saved.dislikeKey === dislikeKey) {
      memory = saved;
      return Promise.resolve(saved);
    }
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve()
      .then(() => fetchTracks(saved?.tracks.map((track) => track.id) || []))
      .then((tracks) => {
        const clean = tracks.slice(0, 5).map((track) => {
          const { resolvedStreamUrl, resolvedStreamTimestamp, ...metadata } = track;
          return metadata;
        });
        const result = { day, tasteRevision: revision, dislikeKey, tracks: clean };
        if (
          latestKey === key &&
          localRecommendationDay(now()) === day &&
          tasteRevision() === revision &&
          clean.length
        ) {
          memory = result;
          try {
            storage.setItem(DAILY_RECOMMENDATIONS_KEY, JSON.stringify(result));
          } catch {
            /* Keep this session stable. */
          }
        }
        return result;
      })
      .finally(() => pending.delete(key));
    pending.set(key, request);
    return request;
  };
}
