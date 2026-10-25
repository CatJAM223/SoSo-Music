import { logger } from '../utils/logger.ts';
export const MAX_COMPUTE_INPUT = 8 * 1024 * 1024;
interface ComputeExports {
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
        exports.abi_version?.() !== 4 ||
        !(exports.memory instanceof WebAssembly.Memory) ||
        [
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
      logger.info('[Compute:Rust] Required local compute core ready (ABI 4)');
      return true;
    } catch (error) {
      core = null;
      localBytes = null;
      logger.error('[Compute:Rust] Required local compute core unavailable', error);
      return false;
    }
  })();
  return initialization;
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
