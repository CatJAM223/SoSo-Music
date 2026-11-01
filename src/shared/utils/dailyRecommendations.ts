import { matchesWaveSource } from '../services/waveSource.ts';
import { requireRustCompute } from '../compute/rustCore.ts';
import type { Track, MusicSource } from '../types/index.ts';
import { createDailyDislikePolicy, type DailyDislikedTrack } from './dailyDislikes.ts';

export const DAILY_RECOMMENDATIONS_KEY = 'soso:daily-recommendations:v1';
export interface DailyRecommendations {
  tasteRevision?: number;
  dislikeKey?: string;
  day: string;
  generatedAt?: number;
  source?: MusicSource;
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
  preserve = 0,
): Track[] {
  return createDailyDislikePolicy(disliked).select(candidates, seeds, preserve);
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
          generatedAt: value.generatedAt,
          source: value.source,
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
  fetchTracks: (
    previousIds: (string | number)[],
    previousTracks?: Track[],
    options?: { source: MusicSource; retainedTracks: Track[] },
  ) => Promise<Track[]>,
  now: () => Date = () => new Date(),
  tasteRevision: () => number = () => 0,
) {
  const pending = new Map<string, Promise<DailyRecommendations>>();
  let memory: DailyRecommendations | null = null;
  let latestKey = '';
  return (dislikeKey = '', source: MusicSource = 'all') => {
    const day = localRecommendationDay(now()),
      revision = tasteRevision(),
      key = JSON.stringify([day, revision, dislikeKey, source]);
    latestKey = key;
    const fresh = (value: DailyRecommendations) =>
      !!requireRustCompute().daily_cache_fresh(
        value.tracks.length,
        now().getTime() - (value.generatedAt ?? NaN),
      );
    if (
      memory?.day === day &&
      fresh(memory) &&
      (memory.source || 'all') === source &&
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
    if (
      saved?.day === day &&
      fresh(saved) &&
      (saved.source || 'all') === source &&
      saved.tasteRevision === revision &&
      saved.dislikeKey === dislikeKey
    ) {
      memory = saved;
      return Promise.resolve(saved);
    }
    const sameDay = saved?.day === day;
    const retained =
      sameDay && saved?.tasteRevision === revision && saved?.dislikeKey === dislikeKey
        ? saved.tracks.filter((track) => matchesWaveSource(track, source))
        : [];
    const previous = sameDay ? [] : saved?.tracks || [];
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve()
      .then(() =>
        fetchTracks(
          previous.map((track) => track.id),
          previous,
          { source, retainedTracks: retained },
        ),
      )
      .catch((error) => {
        if (retained.length) return retained;
        throw error;
      })
      .then((tracks) => {
        const clean = selectDailyRecommendations(
          [...retained, ...tracks.filter((track) => matchesWaveSource(track, source))],
          [],
          [],
          retained.length,
        ).map((track) => {
          const { resolvedStreamUrl, resolvedStreamTimestamp, ...metadata } = track;
          return metadata;
        });
        const result = {
          day,
          generatedAt: now().getTime(),
          source,
          tasteRevision: revision,
          dislikeKey,
          tracks: clean,
        };
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
