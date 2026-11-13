import { logger } from '../utils/logger.ts';
export const MAX_COMPUTE_INPUT = 8 * 1024 * 1024;
interface ComputeExports {
  wave_session_affinity: (matches: number) => number;
  wave_search_limit: (base: number, exposed: number, attempt: number) => number;
  wave_search_retry: (count: number, attempt: number) => number;
  taste_age_weight: (ageMs: number) => number;
  taste_history_score: (raw: number, known: number, weighted: number, legacyAge: number) => number;
  album_match_score: (
    valid: number,
    exact: number,
    contained: number,
    wantedVersion: number,
    actualVersion: number,
  ) => number;
  daily_accepts: (size: number) => number;
  daily_cache_fresh: (count: number, ageMs: number) => number;
  daily_artist_feedback: (count: number) => number;
  wave_duration_allowed: (duration: number) => number;
  wave_memory_ttl: (seconds: number, duration: number) => number;
  daily_refill: (count: number, attempt: number, added: number) => number;
  daily_select: (size: number) => number;
  daily_rejections: (size: number) => number;
  wave_feedback: (played: number, duration: number, reason: number, mood: number) => number;
  rank_search: (size: number) => number;
  recording_match: (size: number) => number;
  memory: WebAssembly.Memory;
  abi_version: () => number;
  reserve: (size: number) => number;
  output_ptr: () => number;
  calculate: (size: number) => number;
  compare_songs: (size: number) => number;
  sequence_wave: (size: number) => number;
  genre_affinity: (size: number) => number;
  music_affinity: (size: number) => number;
  wave_mood_score: (energy: number, mood: number) => number;
  wave_discovery_target: (mood: number, adjustment: number) => number;
  match_import: (size: number) => number;
  demux_push: (size: number) => number;
  demux_reset: () => void;
  demux_boundary: () => number;
  demux_finish: () => number;
  loudness_reset: (rate: number, channels: number) => number;
  loudness_push: (size: number) => number;
  loudness_read: () => number;
  loudness_gap: () => void;
  bounded_genre_score: (score: number) => number;
}
let core: ComputeExports | null = null;
let initialization: Promise<boolean> | null = null;
let localBytes: Uint8Array<ArrayBuffer> | null = null;
export function initializeRustCompute(bytes: BufferSource): Promise<boolean> {
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const copy =
        bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes).slice()
          : new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice();
      const result = await WebAssembly.instantiate(copy, {});
      const exports = result.instance.exports as unknown as ComputeExports;
      if (
        exports.abi_version?.() !== 7 ||
        !(exports.memory instanceof WebAssembly.Memory) ||
        [
          'wave_session_affinity',
          'wave_search_limit',
          'wave_search_retry',
          'taste_age_weight',
          'taste_history_score',
          'album_match_score',
          'daily_accepts',
          'daily_cache_fresh',
          'daily_artist_feedback',
          'wave_duration_allowed',
          'wave_memory_ttl',
          'daily_refill',
          'daily_select',
          'daily_rejections',
          'rank_search',
          'wave_feedback',
          'recording_match',
          'match_import',
          'demux_push',
          'demux_reset',
          'demux_finish',
          'demux_boundary',
          'loudness_reset',
          'loudness_push',
          'loudness_read',
          'loudness_gap',
          'reserve',
          'output_ptr',
          'calculate',
          'compare_songs',
          'sequence_wave',
          'genre_affinity',
          'music_affinity',
          'wave_mood_score',
          'wave_discovery_target',
          'bounded_genre_score',
        ].some(
          (name) => typeof (exports as unknown as Record<string, unknown>)[name] !== 'function',
        )
      )
        throw Error('Unsupported Rust compute ABI');
      core = exports;
      localBytes = copy;
      logger.info('[Compute:Rust] Required local compute core ready (ABI 7)');
      return true;
    } catch (error) {
      core = null;
      localBytes = null;
      logger.error('[Compute:Rust] Required local compute core unavailable', error);
      return false;
    }
  })();
  const attempt = initialization;
  void attempt.then((ready) => {
    if (!ready && initialization === attempt) initialization = null;
  });
  return attempt;
}
export function requireRustCompute(): ComputeExports {
  if (!core) throw Error('Вычислительный модуль Rust не загружен. Перезапустите приложение.');
  return core;
}
export function rustComputeBytes(): Uint8Array<ArrayBuffer> {
  requireRustCompute();
  return localBytes!.slice();
}
export function runRustCompute(
  operation:
    | 'daily_accepts'
    | 'daily_select'
    | 'daily_rejections'
    | 'rank_search'
    | 'recording_match'
    | 'calculate'
    | 'compare_songs'
    | 'sequence_wave'
    | 'genre_affinity'
    | 'music_affinity'
    | 'match_import',
  bytes: Uint8Array,
): Uint8Array<ArrayBuffer> {
  if (!bytes.length || bytes.length > MAX_COMPUTE_INPUT)
    throw Error('Rust compute packet exceeds limits');
  const engine = requireRustCompute();
  const pointer = engine.reserve(bytes.length);
  if (
    !Number.isInteger(pointer) ||
    pointer <= 0 ||
    pointer + bytes.length > engine.memory.buffer.byteLength
  )
    throw Error('Invalid Rust input buffer');
  new Uint8Array(engine.memory.buffer, pointer, bytes.length).set(bytes);
  const size = engine[operation](bytes.length),
    output = engine.output_ptr();
  if (
    !Number.isInteger(size) ||
    size < 0 ||
    !Number.isInteger(output) ||
    output < 0 ||
    output + size > engine.memory.buffer.byteLength
  )
    throw Error('Rust compute rejected the input');
  return new Uint8Array(engine.memory.buffer, output, size).slice();
}
export const waveMoodId = (mood: string): number => {
  const index = ['default', 'energy', 'chill', 'discover', 'mix', 'favorites'].indexOf(mood);
  if (index < 0) throw Error('Unknown wave mood');
  return index;
};
