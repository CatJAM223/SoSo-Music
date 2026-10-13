import { waveMusicMetadata } from '../utils/waveMusicProfile.ts';
import type { Track } from '../types/index.ts';
import { normalizeWaveSeed } from '../utils/waveRecommendations.ts';
import { WAVE_HISTORY_LIMIT, WAVE_HISTORY_TTL_MS } from '../utils/waveHistoryLimits.ts';

export const WAVE_MEMORY_KEY = 'soso:wave-memory:v1';
export const WAVE_PLAYED_TTL = WAVE_HISTORY_TTL_MS;
// Remember proposals between daily visits without treating unheard songs as played.
export const WAVE_OFFERED_TTL = 24 * 60 * 60 * 1000;
interface Entry {
  track: Track;
  at: number;
  seconds?: number;
}
interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** No artwork, signed streams, or audio bytes are needed to remember a recording. */
export function waveMemoryTrack(value: unknown): Track | null {
  const track = normalizeWaveSeed(value);
  if (!track || !track.title.trim() || !track.artist.name.trim() || String(track.id).length > 128)
    return null;
  return {
    id: track.id,
    title: track.title.slice(0, 500),
    artist: { name: track.artist.name.slice(0, 500) },
    album: { title: '' },
    duration: track.duration,
    source: track.source,
    preview: '',
    ...waveMusicMetadata(track),
  };
}

/** Exposure is a soft hint; only real listening excludes a song across app restarts. */
export function createWaveMemory(storage?: StorageLike, now: () => number = Date.now) {
  if (!storage) {
    try {
      if (typeof localStorage !== 'undefined') storage = localStorage;
    } catch {
      /* Memory-only fallback. */
    }
  }
  let played: Entry[] = [],
    offered: Entry[] = [];
  const readEntries = (entries: unknown, ttl: number, limit: number): Entry[] => {
    if (!Array.isArray(entries)) return [];
    const stamp = now();
    const valid: Entry[] = [];
    for (const entry of entries.slice(-limit)) {
      const track = waveMemoryTrack(entry?.track);
      if (
        !track ||
        !Number.isFinite(entry.at) ||
        entry.at > stamp + 60000 ||
        stamp - entry.at > ttl
      )
        continue;
      if (ttl === WAVE_PLAYED_TTL && (!Number.isFinite(entry.seconds) || entry.seconds < 2))
        continue;
      valid.push({ track, at: entry.at, seconds: entry.seconds });
    }
    return valid;
  };
  try {
    const saved = JSON.parse(storage?.getItem(WAVE_MEMORY_KEY) || 'null');
    if (saved?.version === 1) {
      played = readEntries(saved.played, WAVE_PLAYED_TTL, WAVE_HISTORY_LIMIT);
      offered = readEntries(saved.offered, WAVE_OFFERED_TTL, 80);
    }
  } catch {
    /* A broken cache must not stop playback. */
  }
  const prune = () => {
    const stamp = now();
    played = played
      .filter((entry) => stamp - entry.at <= WAVE_PLAYED_TTL)
      .slice(-WAVE_HISTORY_LIMIT);
    offered = offered.filter((entry) => stamp - entry.at <= WAVE_OFFERED_TTL).slice(-80);
  };
  const save = () => {
    prune();
    try {
      storage?.setItem(WAVE_MEMORY_KEY, JSON.stringify({ version: 1, played, offered }));
    } catch {
      /* Full/disabled storage still retains this session. */
    }
  };
  let lastObservation: { id: string; at: number; seconds: number } | undefined;
  return {
    playedTracks() {
      prune();
      return played.map((entry) => entry.track);
    },
    offeredTracks() {
      prune();
      return offered.map((entry) => entry.track);
    },
    recordPlayback(value: Track, seconds: number, force = false): boolean {
      if (!Number.isFinite(seconds) || seconds < 2) return false;
      const id = String(value.id),
        stamp = now();
      if (
        !force &&
        lastObservation?.id === id &&
        stamp - lastObservation.at < 10000 &&
        seconds >= lastObservation.seconds
      )
        return false;
      const track = waveMemoryTrack(value);
      if (!track) return false;
      lastObservation = { id, at: stamp, seconds };
      played = [
        ...played.filter((entry) => String(entry.track.id) !== id),
        { track, at: stamp, seconds },
      ].slice(-WAVE_HISTORY_LIMIT);
      offered = offered.filter((entry) => String(entry.track.id) !== id);
      save();
      return true;
    },
    recordOffered(tracks: readonly Track[]) {
      prune();
      const heard = new Set(played.map((entry) => String(entry.track.id)));
      const stamp = now();
      for (const value of tracks.slice(0, 25)) {
        const track = waveMemoryTrack(value);
        if (!track || heard.has(String(track.id))) continue;
        offered = [
          ...offered.filter((entry) => String(entry.track.id) !== String(track.id)),
          { track, at: stamp },
        ];
      }
      save();
    },
  };
}
