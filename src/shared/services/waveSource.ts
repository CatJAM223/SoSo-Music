import type { MusicSource, Track } from '../types/index.ts';
import { detectTrackSource } from '../utils/formatters.ts';
export const WAVE_SOURCE_KEY = 'soso:wave-source:v1';
export function normalizeWaveSource(value: unknown): MusicSource {
  return value === 'youtube' || value === 'soundcloud' ? value : 'all';
}
export function readWaveSource(): MusicSource {
  try {
    return normalizeWaveSource(localStorage.getItem(WAVE_SOURCE_KEY));
  } catch {
    return 'all';
  }
}
export function saveWaveSource(source: MusicSource): void {
  try {
    localStorage.setItem(WAVE_SOURCE_KEY, source);
  } catch {
    /* Keep the session choice without storage. */
  }
}
export function matchesWaveSource(track: Track, source: MusicSource = 'all'): boolean {
  return source === 'all' || detectTrackSource(track) === source;
}
