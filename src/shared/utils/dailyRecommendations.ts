import { matchesWaveSource } from '../services/waveSource.ts';
import { requireRustCompute } from '../compute/rustCore.ts';
import type { Track, MusicSource } from '../types/index.ts';
import type { WaveSearchOptions } from '../types/wavePolicy.ts';
import { readWaveRecommendation } from '../services/waveQuality.ts';
import { createDailyDislikePolicy, type DailyDislikedTrack } from './dailyDislikes.ts';
import { createWaveShowMatcher } from './waveIdentity.ts';

export const DAILY_RECOMMENDATIONS_KEY = 'soso:daily-recommendations:v1';
const DAILY_HISTORY_DAYS = 14;
const DAILY_SHOWS_PER_DAY = 15;
export const DAILY_HISTORY_LIMIT = DAILY_HISTORY_DAYS * DAILY_SHOWS_PER_DAY;
type DailyShows = { day: string; tracks: Track[] };
interface DailySnapshot {
  tasteRevision?: number;
  dislikeKey?: string;
  day: string;
  generatedAt?: number;
  source?: MusicSource;
  tracks: Track[];
}
export interface DailyRecommendations extends DailySnapshot {
  shows?: DailyShows[];
  snapshots?: DailySnapshot[];
}
function snapshotOnly({
  day,
  generatedAt,
  source,
  tasteRevision,
  dislikeKey,
  tracks,
}: DailySnapshot): DailySnapshot {
  return { day, generatedAt, source, tasteRevision, dislikeKey, tracks };
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

function readDailySnapshot(value: any): DailySnapshot | null {
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
    )
    .map((track: Track) => {
      if (track.waveRecommendation === undefined) return track;
      const { waveRecommendation, ...rest } = track;
      const attribution = readWaveRecommendation(waveRecommendation);
      return attribution ? { ...rest, waveRecommendation: attribution } : rest;
    });
  return {
    day: value.day,
    generatedAt: value.generatedAt,
    source: value.source,
    dislikeKey: typeof value.dislikeKey === 'string' ? value.dislikeKey : '',
    tasteRevision: Number.isSafeInteger(value.tasteRevision) ? value.tasteRevision : undefined,
    tracks,
  };
}

export function readDailyRecommendations(raw: string | null): DailyRecommendations | null {
  try {
    const value = JSON.parse(raw || 'null');
    const snapshot = readDailySnapshot(value);
    if (!snapshot) return null;
    const shows = Array.isArray(value.shows)
      ? value.shows.slice(-(DAILY_HISTORY_DAYS + 1)).flatMap((row: DailyShows) => {
          if (!row || !/^\d{4}-\d{2}-\d{2}$/.test(row.day) || !Array.isArray(row.tracks)) return [];
          const tracks = row.tracks
            .slice(-DAILY_SHOWS_PER_DAY)
            .filter(
              (track) =>
                track &&
                ['string', 'number'].includes(typeof track.id) &&
                String(track.id).length <= 128 &&
                typeof track.title === 'string' &&
                typeof track.artist?.name === 'string',
            )
            .map(dailyShowTrack);
          return [{ day: row.day, tracks }];
        })
      : undefined;
    const snapshots = Array.isArray(value.snapshots)
      ? value.snapshots
          .slice(-2)
          .map(readDailySnapshot)
          .filter((item: DailySnapshot | null) => item !== null)
      : undefined;
    return snapshot.tracks.length || shows ? { ...snapshot, shows, snapshots } : null;
  } catch {
    return null;
  }
}

function dailyShowTrack(track: Track): Track {
  return {
    id: track.id,
    recordingId:
      typeof track.recordingId === 'string' ? track.recordingId.slice(0, 1024) : undefined,
    title: track.title.slice(0, 500),
    artist: { name: track.artist.name.slice(0, 500) },
    album: { title: '' },
    duration: track.duration,
    source: track.source,
    preview: '',
  };
}

function recentDailyShows(saved: DailyRecommendations | null, date: Date): DailyShows[] {
  if (!saved) return [];
  const cutoff = new Date(date.getFullYear(), date.getMonth(), date.getDate() - DAILY_HISTORY_DAYS);
  const start = localRecommendationDay(cutoff);
  const today = localRecommendationDay(date);
  return (saved.shows || [{ day: saved.day, tracks: saved.tracks.map(dailyShowTrack) }]).filter(
    (row) => row.day >= start && row.day <= today,
  );
}

/** Earlier shows arrive first. An alias inherits the last show of the recording. */
export function orderDailyRepeats(
  candidates: Track[],
  previous: Track[],
  freshOnly = false,
): Track[] {
  const lastShow = createWaveShowMatcher(previous);
  return candidates
    .map((track) => ({ track, last: lastShow(track, undefined, freshOnly) }))
    .filter(({ last }) => !freshOnly || last < 0)
    .sort((a, b) => a.last - b.last)
    .map(({ track }) => track);
}

/** A local-day snapshot; generating one does not update listening history. */
export function createDailyRecommendationLoader(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  fetchTracks: (
    previousIds: (string | number)[],
    previousTracks?: Track[],
    options?: WaveSearchOptions & { source: MusicSource; retainedTracks: Track[] },
  ) => Promise<Track[]>,
  now: () => Date = () => new Date(),
  tasteRevision: () => number = () => 0,
) {
  const pending = new Map<string, Promise<DailySnapshot>>();
  let memory: DailyRecommendations | null = null;
  let latestKey = '';
  return (dislikeKey = '', source: MusicSource = 'all', options?: WaveSearchOptions) => {
    const date = now(),
      day = localRecommendationDay(date),
      revision = tasteRevision(),
      key = JSON.stringify([day, revision, dislikeKey, source]);
    latestKey = key;
    const fresh = (value: DailySnapshot) =>
      value.tracks.length > 0 &&
      !!requireRustCompute().daily_cache_fresh(
        value.tracks.length,
        now().getTime() - (value.generatedAt ?? NaN),
      );
    let saved = memory;
    if (!saved) {
      try {
        saved = readDailyRecommendations(storage.getItem(DAILY_RECOMMENDATIONS_KEY));
      } catch {
        /* Memory works when storage is unavailable. */
      }
    }
    const currentSnapshots = saved
      ? [saved, ...(saved.snapshots || [])].filter(
          (snapshot) =>
            snapshot.day === day &&
            snapshot.tasteRevision === revision &&
            snapshot.dislikeKey === dislikeKey,
        )
      : [];
    const current = currentSnapshots.find((snapshot) => (snapshot.source || 'all') === source);
    if (current && fresh(current)) {
      memory = saved;
      return Promise.resolve(snapshotOnly(current));
    }
    const retained =
      (current || currentSnapshots[0])?.tracks.filter((track) =>
        matchesWaveSource(track, source),
      ) || [];
    const shows = recentDailyShows(saved, date);
    const previous = shows
      .filter((row) => row.day < day)
      .flatMap((row) => row.tracks)
      .slice(-DAILY_HISTORY_LIMIT);
    const existing = pending.get(key);
    if (existing) return existing;
    const request = Promise.resolve()
      .then(() =>
        fetchTracks(
          previous.map((track) => track.id),
          previous,
          { ...options, source, retainedTracks: retained },
        ),
      )
      .catch((error) => {
        if (retained.length) return retained;
        throw error;
      })
      .then((tracks) => {
        const clean = selectDailyRecommendations(
          tracks.filter((track) => matchesWaveSource(track, source)),
          [],
          [],
          5,
        ).map((track) => {
          const { resolvedStreamUrl, resolvedStreamTimestamp, ...metadata } = track;
          return metadata;
        });
        const currentShows = new Map(
          (shows.find((row) => row.day === day)?.tracks || []).map((track) => [
            String(track.id),
            track,
          ]),
        );
        for (const track of clean) {
          currentShows.delete(String(track.id));
          currentShows.set(String(track.id), dailyShowTrack(track));
        }
        const result: DailySnapshot = {
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
          tasteRevision() === revision
        ) {
          memory = {
            ...result,
            shows: [
              ...shows.filter((row) => row.day < day),
              { day, tracks: [...currentShows.values()].slice(-DAILY_SHOWS_PER_DAY) },
            ].slice(-(DAILY_HISTORY_DAYS + 1)),
            snapshots: currentSnapshots
              .filter((snapshot) => (snapshot.source || 'all') !== source)
              .slice(0, 2)
              .map(snapshotOnly),
          };
          try {
            storage.setItem(DAILY_RECOMMENDATIONS_KEY, JSON.stringify(memory));
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
